import { createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import logo from "./assets/logo.png";

interface TranslatorConfig {
  base_url: string;
  api_key: string;
  model: string;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  top_k: number | null;
  stream: boolean;
  threads: number;
  batch_size: number;
  delay: number;
  last_file: string;
}

interface ProgressEvent {
  thread_id: number;
  current: number;
  total: number;
  message: string;
  append: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `# ROLE: Master of Game Localization (English to Vietnamese)

# CONTEXT: Game translation, Vietnamese language.

## 1. TRANSCREATION & STYLE (THE 'SMOOTH' FACTOR):
- TRANSLATE NATURALLY: DO NOT TRANSLATE WORD-FOR-WORD. Rewrite the sentence so that it sounds natural, like standard Vietnamese.
- EVOCATIVE PROSE: Use rich, sharp, and mysterious vocabulary fitting for a dying world. Avoid passive voice (e.g., 'Bị/Được') unless necessary.
- CONTEXTUAL ADAPTATION: If a sentence is an idiom or joke, replace it with a Vietnamese equivalent that carries the same vibe.

## 2. PRONOUNS & VIBE:
- Choose the appropriate personal pronoun depending on the context and gender.
- Character Voice: A child should sound innocent, a general should sound stern, and a villain should sound menacing.

## 3. FINAL EXECUTION:
Translate ALL lines, without omitting anything. Make the translation smooth, impressive, and engaging. Start now.`;

export default function Translator() {
  const [config, setConfig] = createSignal<TranslatorConfig>({
    base_url: "https://api.mistral.ai/v1",
    api_key: "",
    model: "mistral-large-latest",
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.2,
    max_tokens: 4096,
    top_p: 1.0,
    top_k: -1,
    stream: true,
    threads: 1,
    batch_size: 50,
    delay: 1.3,
    last_file: "",
  });

  const [models, setModels] = createSignal<string[]>([]);
  const [isRunning, setIsRunning] = createSignal(false);
  const [progress, setProgress] = createSignal<Record<number, ProgressEvent>>({});
  const [threadLogs, setThreadLogs] = createSignal<Record<number, string>>({});

  const [showSettings, setShowSettings] = createSignal(false);
  const [monitorThreadId, setMonitorThreadId] = createSignal<number | null>(null);

  // Model Dropdown State
  const [isModelDropdownOpen, setIsModelDropdownOpen] = createSignal(false);
  let modelDropdownRef: HTMLDivElement | undefined;

  onMount(async () => {
    try {
      const loaded = await invoke<TranslatorConfig | null>("load_config");
      if (loaded) {
        setConfig(prev => ({ ...prev, ...loaded }));
      } else {
        const saved = localStorage.getItem("wuwa_config");
        if (saved) {
          try {
            setConfig(prev => ({ ...prev, ...JSON.parse(saved) }));
          } catch (e) { }
        }
      }
    } catch (e) {
      console.error("Failed to load config from file", e);
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef && !modelDropdownRef.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  createEffect(() => {
    const currentConfig = config();
    localStorage.setItem("wuwa_config", JSON.stringify(currentConfig));
    invoke("save_config", { config: currentConfig }).catch(e => console.error(e));
  });

  createEffect(() => {
    const unlistenPromise = listen<ProgressEvent>("progress", (event) => {
      const p = event.payload;
      setProgress((prev) => ({ ...prev, [p.thread_id]: p }));
      if (p.message) {
        setThreadLogs((prev) => {
          const oldLog = prev[p.thread_id] || "";
          const newLog = p.append ? oldLog + p.message : oldLog + "\n> " + p.message + "\n";
          return { ...prev, [p.thread_id]: newLog };
        });
      }
    });
    return () => {
      unlistenPromise.then((f) => f());
    };
  });

  const handleFileSelect = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Text", extensions: ["txt", "csv"] }],
    });
    if (selected) {
      setConfig({ ...config(), last_file: selected as string });
    }
  };

  const fetchModels = async () => {
    try {
      const res = await invoke<string[]>("fetch_models", {
        baseUrl: config().base_url,
        apiKey: config().api_key,
      });
      setModels(res);
      if (!config().model && res.length > 0) {
        setConfig(prev => ({ ...prev, model: res[0] }));
      }
      setIsModelDropdownOpen(true);
    } catch (e) {
      alert(`Error fetching models: ${e}`);
    }
  };

  const startTranslation = async () => {
    if (!config().last_file) {
      alert("Please select a file first.");
      return;
    }
    setIsRunning(true);
    setProgress({});
    setThreadLogs({});
    try {
      await invoke("start_translation", {
        config: config(),
        filePath: config().last_file,
      });
      alert("Translation finished!");
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setIsRunning(false);
    }
  };

  const stopTranslation = async () => {
    await invoke("stop_translation");
  };

  const filteredModels = () => {
    const query = config().model.toLowerCase();
    return models().filter(m => m.toLowerCase().includes(query));
  };

  return (
    <div class="p-6 max-w-2xl mx-auto text-gray-100 min-h-screen flex flex-col gap-6">

      {/* Header */}
      <div class="flex justify-between items-center border-b border-gray-700 pb-4">
        <div class="flex items-center gap-3">
          <img src={logo} class="w-10 h-10 rounded shadow-lg border border-gray-600" alt="App Logo" />
          <h2 class="text-2xl font-bold text-green-500">Game Translate <span class="text-xs text-gray-500">v7</span></h2>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-semibold transition-colors"
        >
          ⚙ Settings
        </button>
      </div>

      {/* Main Configuration */}
      <div class="space-y-4 bg-gray-800 p-4 rounded-xl shadow-lg">

        {/* Base URL */}
        <div class="flex items-center gap-4">
          <label class="w-16 text-sm font-medium text-gray-400">URL:</label>
          <input
            type="text"
            class="flex-1 bg-gray-700 border border-gray-600 rounded p-2 focus:border-green-500 outline-none"
            value={config().base_url}
            onInput={(e) => setConfig({ ...config(), base_url: e.currentTarget.value })}
          />
        </div>

        {/* API Key */}
        <div class="flex items-center gap-4">
          <label class="w-16 text-sm font-medium text-gray-400">Key:</label>
          <input
            type="password"
            class="flex-1 bg-gray-700 border border-gray-600 rounded p-2 focus:border-green-500 outline-none"
            value={config().api_key}
            onInput={(e) => setConfig({ ...config(), api_key: e.currentTarget.value })}
          />
        </div>

        {/* Custom Model Combobox */}
        <div class="flex items-center gap-4 relative z-10" ref={modelDropdownRef}>
          <label class="w-16 text-sm font-medium text-gray-400">Model:</label>
          <div class="flex-1 flex gap-2 relative">
            <div class="flex-1 relative">
              <input
                type="text"
                class="w-full bg-gray-700 border border-gray-600 rounded-l p-2 focus:border-green-500 outline-none"
                value={config().model}
                onInput={(e) => {
                  setConfig({ ...config(), model: e.currentTarget.value });
                  setIsModelDropdownOpen(true);
                }}
                onFocus={() => setIsModelDropdownOpen(true)}
                placeholder="Select or type model..."
              />
              <button
                class="absolute right-0 top-0 h-full px-2 text-gray-400 hover:text-white"
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen())}
              >
                ▼
              </button>
            </div>

            <Show when={isModelDropdownOpen() && filteredModels().length > 0}>
              <div class="absolute top-full left-0 w-full bg-gray-800 border border-gray-600 rounded-b shadow-xl max-h-60 overflow-y-auto custom-scrollbar mt-1 z-50">
                <For each={filteredModels()}>
                  {(m) => (
                    <div
                      class="p-2 hover:bg-green-600 cursor-pointer text-sm truncate"
                      onClick={() => {
                        setConfig({ ...config(), model: m });
                        setIsModelDropdownOpen(false);
                      }}
                    >
                      {m}
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <button
              onClick={fetchModels}
              class="px-3 bg-gray-600 hover:bg-gray-500 rounded-r text-xl"
              title="Fetch Models"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Args grid */}
        <div class="bg-gray-900/50 p-3 rounded grid grid-cols-3 gap-4 border border-gray-700 z-0">
          <div class="text-center">
            <label class="block text-xs text-gray-400 mb-1">Threads</label>
            <input
              type="number"
              class="w-full bg-gray-700 border border-gray-600 rounded p-1 text-center"
              value={config().threads}
              onInput={(e) => setConfig({ ...config(), threads: parseInt(e.currentTarget.value) })}
            />
          </div>
          <div class="text-center">
            <label class="block text-xs text-gray-400 mb-1">Batch</label>
            <input
              type="number"
              class="w-full bg-gray-700 border border-gray-600 rounded p-1 text-center"
              value={config().batch_size}
              onInput={(e) => setConfig({ ...config(), batch_size: parseInt(e.currentTarget.value) })}
            />
          </div>
          <div class="text-center">
            <label class="block text-xs text-gray-400 mb-1">Delay (s)</label>
            <input
              type="number" step="0.1"
              class="w-full bg-gray-700 border border-gray-600 rounded p-1 text-center"
              value={config().delay}
              onInput={(e) => setConfig({ ...config(), delay: parseFloat(e.currentTarget.value) })}
            />
          </div>
        </div>

        <div class="flex items-center gap-4">
          <label class="w-16 text-sm font-medium text-gray-400">File:</label>
          <div class="flex-1 flex gap-2">
            <input
              readOnly
              value={config().last_file}
              class="flex-1 bg-gray-700 border border-gray-600 rounded p-2 text-gray-300"
            />
            <button
              onClick={handleFileSelect}
              class="px-4 bg-gray-600 hover:bg-gray-500 rounded font-bold"
            >
              📂
            </button>
          </div>
        </div>

      </div>

      <div class="flex gap-4">
        <button
          onClick={startTranslation}
          disabled={isRunning()}
          class={`flex-1 py-3 rounded font-bold text-lg shadow-lg transition-transform active:scale-95 ${isRunning()
            ? "bg-gray-600 cursor-not-allowed text-gray-400"
            : "bg-green-600 hover:bg-green-700 text-white"
            }`}
        >
          START TRANSLATING
        </button>
        <button
          onClick={stopTranslation}
          disabled={!isRunning()}
          class={`px-8 py-3 rounded font-bold text-lg shadow-lg transition-transform active:scale-95 ${!isRunning()
            ? "bg-gray-800 cursor-not-allowed text-gray-600 border border-gray-700"
            : "bg-red-600 hover:bg-red-700 text-white"
            }`}
        >
          STOP
        </button>
      </div>

      <div class="flex-1 bg-gray-800 rounded-xl shadow-lg p-4 overflow-hidden flex flex-col">
        <h3 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Thread Progress</h3>
        <div class="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
          <For each={Object.keys(progress())}>
            {(threadIdKey) => {
              const threadId = parseInt(threadIdKey);
              // Using a derived signal for this specific thread to ensure fine-grained reactivity
              const p = () => progress()[threadId];

              return (
                <div class="bg-gray-700/50 p-3 rounded flex items-center gap-3">
                  <div class="w-24 text-xs font-mono text-gray-400 flex-none">Thread {threadId}</div>
                  <div class="flex-1 h-3 bg-gray-900 rounded-full overflow-hidden relative">
                    <div
                      class="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${p().total > 0 ? (p().current / p().total) * 100 : 0}%` }}
                    />
                  </div>
                  <div class="w-12 text-xs font-bold text-right flex-none">
                    {Math.round(p().total > 0 ? (p().current / p().total) * 100 : 0)}%
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMonitorThreadId(threadId);
                    }}
                    class="w-8 h-8 flex-none bg-gray-600 hover:bg-gray-500 rounded flex items-center justify-center font-bold transition-colors"
                  >
                    {">"}
                  </button>
                </div>
              );
            }}
          </For>
          {Object.keys(progress()).length === 0 && (
            <div class="text-center text-gray-500 py-10 opacity-50">
              Ready to start...
            </div>
          )}
        </div>
      </div>

      <Show when={showSettings()}>
        <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div class="bg-gray-800 w-full max-w-lg rounded-xl shadow-2xl border border-gray-700 flex flex-col max-h-[90vh]">
            <div class="p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 class="text-xl font-bold">Advanced Settings</h2>
              <button onClick={() => setShowSettings(false)} class="text-gray-400 hover:text-white">✕</button>
            </div>

            <div class="p-6 overflow-y-auto space-y-4 custom-scrollbar">
              <div>
                <label class="block text-sm font-bold mb-2">System Prompt</label>
                <textarea
                  class="w-full h-32 bg-gray-900 border border-gray-600 rounded p-2 text-xs font-mono focus:border-green-500 outline-none custom-scrollbar"
                  value={config().system_prompt}
                  onInput={(e) => setConfig({ ...config(), system_prompt: e.currentTarget.value })}
                />
              </div>

              <div class="grid grid-cols-2 gap-4">
                <SettingInput
                  label="Temperature"
                  value={config().temperature}
                  step={0.1}
                  onChange={(v) => setConfig({ ...config(), temperature: v })}
                />
                <SettingInput
                  label="Max Tokens"
                  value={config().max_tokens}
                  step={1}
                  onChange={(v) => setConfig({ ...config(), max_tokens: v })}
                />
                <SettingInput
                  label="Top P"
                  value={config().top_p}
                  step={0.1}
                  onChange={(v) => setConfig({ ...config(), top_p: v })}
                />
                <SettingInput
                  label="Top K"
                  value={config().top_k}
                  step={1}
                  onChange={(v) => setConfig({ ...config(), top_k: v })}
                />
              </div>

              <div class="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  id="stream_chk"
                  class="w-4 h-4 rounded bg-gray-900 border-gray-600 text-green-600 focus:ring-green-500"
                  checked={config().stream}
                  onChange={(e) => setConfig({ ...config(), stream: e.currentTarget.checked })}
                />
                <label for="stream_chk" class="text-sm font-bold">Stream Output (Real-time logs)</label>
              </div>
            </div>

            <div class="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-xl flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                class="bg-green-600 hover:bg-green-700 px-6 py-2 rounded font-bold text-white shadow"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={monitorThreadId() !== null}>
        <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div class="bg-gray-800 w-full max-w-3xl h-[80vh] rounded-xl shadow-2xl border border-gray-700 flex flex-col">
            <div class="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900 rounded-t-xl">
              <h2 class="text-lg font-mono font-bold text-green-400">Thread {monitorThreadId()} Stream Monitor</h2>
              <button onClick={() => setMonitorThreadId(null)} class="text-gray-400 hover:text-white px-2">✕</button>
            </div>
            <div class="flex-1 bg-black p-4 overflow-hidden relative">
              <MonitorTextarea log={threadLogs()[monitorThreadId()!] || "No logs yet..."} />
            </div>
          </div>
        </div>
      </Show>

    </div>
  );
}

// Reusable component for settings with toggle
function SettingInput(props: {
  label: string;
  value: number | null;
  step: number;
  onChange: (val: number | null) => void;
}) {
  // If value is null, it's disabled.
  const isEnabled = () => props.value !== null;

  // Use a temp value for input when disabled to show something (or 0)
  const displayValue = () => props.value !== null ? props.value : 0;

  return (
    <div>
      <div class="flex justify-between items-center mb-1">
        <label class={`text-sm font-bold ${isEnabled() ? "text-gray-200" : "text-gray-500"}`}>
          {props.label}
        </label>
        <div class="flex items-center">
          <input
            type="checkbox"
            class="w-3 h-3 rounded bg-gray-700 border-gray-500 text-green-500 focus:ring-0"
            checked={isEnabled()}
            onChange={(e) => {
              if (e.currentTarget.checked) {
                // Enable with default value (0 or similar)
                props.onChange(props.step === 1 ? 4096 : 0.7);
              } else {
                props.onChange(null);
              }
            }}
          />
        </div>
      </div>
      <input
        type="number"
        step={props.step}
        disabled={!isEnabled()}
        class={`w-full bg-gray-900 border rounded p-2 transition-colors ${isEnabled()
          ? "border-gray-600 text-white"
          : "border-gray-800 text-gray-600 cursor-not-allowed"
          }`}
        value={displayValue()}
        onInput={(e) => isEnabled() && props.onChange(parseFloat(e.currentTarget.value))}
      />
    </div>
  );
}

// Sub-component for auto-scrolling textarea
function MonitorTextarea(props: { log: string }) {
  let ref: HTMLTextAreaElement | undefined;

  // Auto-scroll logic: only scroll if the user is already near the bottom
  createEffect(() => {
    if (ref && props.log) {
      const distanceToBottom = ref.scrollHeight - ref.scrollTop - ref.clientHeight;
      // Tolerance of 80px allows for some buffer
      if (distanceToBottom < 80) {
        ref.scrollTop = ref.scrollHeight;
      }
    }
  });

  // Initial scroll on open
  onMount(() => {
    if (ref) ref.scrollTop = ref.scrollHeight;
  });

  return (
    <textarea
      ref={ref}
      class="w-full h-full bg-black font-mono text-xs text-green-500 resize-none outline-none leading-relaxed custom-scrollbar"
      readOnly
      value={props.log}
    />
  );
}
