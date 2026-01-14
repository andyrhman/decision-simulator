import React, { useState, useEffect, useRef } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import {
    Container,
    Row,
    Col,
    Form,
    Button,
    ListGroup,
    InputGroup,
    Card,
    Badge,
    Modal,
    ProgressBar,
    Tabs,
    Tab,
} from "react-bootstrap";

const GITHUB_URL = "https://github.com/andyrhman";
const DICE_STORAGE_KEY = "dice_v1";
const PITY_STORAGE_KEY = "pity_v1";
const PITY_HARDHITS_KEY = "pity_hardhits_v1";
const PITY_SETTINGS_KEY = "pity_settings_v1";

// Default dice mapping (used when no saved settings)
const DEFAULT_DICE = [
    { num: 1, sec: 3 },
    { num: 2, sec: 5 },
    { num: 3, sec: 7 },
    { num: 4, sec: 8 },
    { num: 5, sec: 9 },
    { num: 6, sec: 10 },
];

// Default pity settings
const DEFAULT_PITY_SETTINGS = {
    enabled: true,
    softIncrement: 1, // per-miss increment
    hardThreshold: 12, // guaranteed after this many misses
    softMultiplierCap: 5, // max multiplier
    autoResetWhenAllHardHit: false, // auto-reset when all faces hit via hard-pity
};

export default function DecisionMakerApp() {
    // --- storage helpers ---
    function readFromStorage(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (err) {
            console.warn("readFromStorage error", key, err);
            return fallback;
        }
    }
    function saveToStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn("saveToStorage error", key, err);
        }
    }
    function readPresets() {
        return readFromStorage("presets_v1", []);
    }
    function readDecisions() {
        return readFromStorage("decisions_v1", []);
    }
    function readHistory() {
        return readFromStorage("history_v1", []);
    }
    function readDice() {
        const d = readFromStorage(DICE_STORAGE_KEY, null);
        if (Array.isArray(d) && d.every((x) => x && typeof x.num === "number" && typeof x.sec === "number")) {
            return d;
        }
        return DEFAULT_DICE.slice();
    }
    function readPityAll() {
        return readFromStorage(PITY_STORAGE_KEY, {});
    }
    function readPityHardHitsAll() {
        return readFromStorage(PITY_HARDHITS_KEY, {});
    }
    function readPitySettings() {
        return readFromStorage(PITY_SETTINGS_KEY, DEFAULT_PITY_SETTINGS);
    }

    function resolveScopeKey(scopeChoice) {
        if (scopeChoice === "preset" && currentPresetId) return currentPresetId;
        return "global";
    }

    // --- state ---
    const [input, setInput] = useState("");
    const [decisions, setDecisions] = useState(() => readDecisions() || []);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [isRunning, setIsRunning] = useState(false);

    // presets
    const [presets, setPresets] = useState(() => readPresets() || []);
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [editingPresetId, setEditingPresetId] = useState(null);

    // history
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyEntries, setHistoryEntries] = useState(() => readHistory() || []);
    const [historyPage, setHistoryPage] = useState(1);
    const HISTORY_PAGE_SIZE = 10;

    // dice & settings modal (combined)
    const [diceSettings, setDiceSettings] = useState(() => readDice());
    const [pityAll, setPityAll] = useState(() => readPityAll());
    const [pityHardHitsAll, setPityHardHitsAll] = useState(() => readPityHardHitsAll());
    const [pitySettings, setPitySettings] = useState(() => readPitySettings());

    // modal local edits
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [activeSettingsTab, setActiveSettingsTab] = useState("dice"); // 'dice' | 'pity'
    const [diceEdit, setDiceEdit] = useState([]);
    const [diceEditErrors, setDiceEditErrors] = useState({});
    const [pityEdit, setPityEdit] = useState({ ...readPitySettings() });
    const [pityScopeChoice, setPityScopeChoice] = useState("global");
    const [settingsSaveError, setSettingsSaveError] = useState("");

    // UI dice/progress
    const [diceRoll, setDiceRoll] = useState(null);
    const [diceDurationSec, setDiceDurationSec] = useState(null);
    const [progress, setProgress] = useState(0);

    // preset scope
    const [currentPresetId, setCurrentPresetId] = useState(null);

    // refs
    const spinTimeoutRef = useRef(null);
    const progressIntervalRef = useRef(null);
    const startTimeRef = useRef(null);
    const spinRunningRef = useRef(false);
    const presetsLoadedRef = useRef(false);

    // --- normalize/load on mount ---
    useEffect(() => {
        try {
            const p = readFromStorage("presets_v1", []);
            if (p) setPresets(p);
        } catch (e) {
            console.warn(e);
        } finally {
            presetsLoadedRef.current = true;
        }
    }, []);

    // autosave
    useEffect(() => saveToStorage("decisions_v1", decisions), [decisions]);
    useEffect(() => { if (presetsLoadedRef.current) saveToStorage("presets_v1", presets); }, [presets]);
    useEffect(() => saveToStorage("history_v1", historyEntries), [historyEntries]);
    useEffect(() => saveToStorage(DICE_STORAGE_KEY, diceSettings), [diceSettings]);
    useEffect(() => saveToStorage(PITY_STORAGE_KEY, pityAll), [pityAll]);
    useEffect(() => saveToStorage(PITY_HARDHITS_KEY, pityHardHitsAll), [pityHardHitsAll]);
    useEffect(() => { saveToStorage(PITY_SETTINGS_KEY, pitySettings); setPityEdit({ ...pitySettings }); }, [pitySettings]);

    useEffect(() => {
        return () => {
            if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            spinRunningRef.current = false;
        };
    }, []);

    // --- helpers ---
    function decisionKeyFromText(text) { return String(text); }
    function getScopeKey() { return currentPresetId || "global"; }
    function readPityForScope(scopeKey) {
        const k = scopeKey || getScopeKey();
        const all = readPityAll();
        return all && all[k] ? { ...all[k] } : {};
    }
    function savePityForScope(scopeKey, map) {
        const k = scopeKey || getScopeKey();
        setPityAll((prev) => { const copy = { ...(prev || {}) }; copy[k] = { ...(map || {}) }; return copy; });
    }
    function loadHardHitsForScope(scopeKey) {
        const k = scopeKey || getScopeKey();
        const all = readPityHardHitsAll();
        return all && Array.isArray(all[k]) ? new Set(all[k]) : new Set();
    }
    function saveHardHitsForScope(scopeKey, setOfKeys) {
        const k = scopeKey || getScopeKey();
        setPityHardHitsAll((prev) => { const copy = { ...(prev || {}) }; copy[k] = Array.from(setOfKeys || []); return copy; });
    }

    function weightedRandomIndex(weights) {
        const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
        if (total <= 0) return Math.floor(Math.random() * weights.length);
        let r = Math.random() * total;
        for (let i = 0; i < weights.length; i++) {
            r -= Math.max(0, weights[i]);
            if (r <= 0) return i;
        }
        return weights.length - 1;
    }

    function pickWithPity(decisionsArr, pityCountsForScope, pityCfg) {
        const softInc = Number(pityCfg.softIncrement) || 1;
        const hardTh = Number(pityCfg.hardThreshold) || 12;
        const cap = Number(pityCfg.softMultiplierCap) || 5;
        let hardCandidateIndex = -1;
        let highestPity = -1;
        const weights = [];
        for (let i = 0; i < decisionsArr.length; i++) {
            const key = decisionKeyFromText(decisionsArr[i]);
            const pity = Number((pityCountsForScope && pityCountsForScope[key]) || 0);
            if (pity >= hardTh) {
                if (pity > highestPity) { highestPity = pity; hardCandidateIndex = i; }
            }
            const base = 1;
            const rawWeight = base + softInc * pity;
            const maxWeight = base * cap;
            const weight = Math.min(rawWeight, maxWeight);
            weights.push(weight);
        }
        if (hardCandidateIndex >= 0) return { chosenIndex: hardCandidateIndex, method: "hard-pity" };
        const idx = weightedRandomIndex(weights);
        return { chosenIndex: idx, method: "soft-weight" };
    }

    function applyPityUpdate(scopeKey, decisionsArr, chosenIndex, method) {
        const keyScope = scopeKey || getScopeKey();
        const allPity = { ...(pityAll || {}) };
        const counts = allPity[keyScope] ? { ...allPity[keyScope] } : {};
        const hardHitsAll = { ...(pityHardHitsAll || {}) };
        const hardHitsSet = new Set(hardHitsAll[keyScope] || []);
        for (let i = 0; i < decisionsArr.length; i++) {
            const key = decisionKeyFromText(decisionsArr[i]);
            if (i === chosenIndex) counts[key] = 0;
            else counts[key] = (Number(counts[key]) || 0) + 1;
        }
        if (method === "hard-pity") {
            const chosenKey = decisionKeyFromText(decisionsArr[chosenIndex]);
            hardHitsSet.add(chosenKey);
            hardHitsAll[keyScope] = Array.from(hardHitsSet);
            setPityHardHitsAll(hardHitsAll);
        }
        allPity[keyScope] = counts;
        setPityAll(allPity);
        const cfg = pitySettings || DEFAULT_PITY_SETTINGS;
        if (cfg.autoResetWhenAllHardHit) {
            const needed = new Set(decisionsArr.map((d) => decisionKeyFromText(d)));
            let allHit = true;
            for (const nk of needed) if (!hardHitsSet.has(nk)) { allHit = false; break; }
            if (allHit) {
                const cleared = {};
                for (const d of decisionsArr) cleared[decisionKeyFromText(d)] = 0;
                allPity[keyScope] = cleared;
                setPityAll(allPity);
                hardHitsAll[keyScope] = [];
                setPityHardHitsAll(hardHitsAll);
            }
        }
    }

    function resetPityForScope(scopeKey) {
        const key = scopeKey || getScopeKey();
        const all = { ...(pityAll || {}) };
        const cleared = {};
        for (const d of decisions) cleared[decisionKeyFromText(d)] = 0;
        all[key] = cleared;
        setPityAll(all);
        const hardAll = { ...(pityHardHitsAll || {}) };
        hardAll[key] = [];
        setPityHardHitsAll(hardAll);
    }

    // --- decisions / presets / history ---
    function addDecision(e) {
        e?.preventDefault();
        const t = input.trim();
        if (!t) return;
        setDecisions((d) => [...d, t]);
        setInput("");
        if (activeIndex === -1) setActiveIndex(0);
    }
    function removeDecision(idx) {
        setDecisions((d) => d.filter((_, i) => i !== idx));
        setActiveIndex((old) => (old === idx ? -1 : old > idx ? old - 1 : old));
    }
    function clearAll() { setDecisions([]); setActiveIndex(-1); }

    function openSavePresetModal(editId = null) {
        if (editId) {
            const p = presets.find((x) => x.id === editId);
            if (p) { setPresetName(p.name); setEditingPresetId(editId); }
        } else { setPresetName(""); setEditingPresetId(null); }
        setShowPresetModal(true);
    }
    function closePresetModal() { setShowPresetModal(false); setPresetName(""); setEditingPresetId(null); }
    function savePreset() {
        const snapshot = decisions.slice();
        const nameTrim = presetName.trim() || `Preset ${new Date().toLocaleString()}`;
        if (editingPresetId) {
            setPresets((ps) => {
                const updated = ps.map((p) => (p.id === editingPresetId ? { ...p, name: nameTrim, decisions: snapshot } : p));
                try { saveToStorage("presets_v1", updated); } catch (err) { }
                return updated;
            });
        } else {
            const id = Date.now().toString();
            setPresets((ps) => {
                const updated = [...ps, { id, name: nameTrim, decisions: snapshot }];
                try { saveToStorage("presets_v1", updated); } catch (err) { }
                return updated;
            });
        }
        closePresetModal();
    }
    function applyPreset(id) {
        const p = presets.find((x) => x.id === id);
        if (p && Array.isArray(p.decisions)) {
            setDecisions(p.decisions.slice());
            setActiveIndex(p.decisions.length > 0 ? 0 : -1);
            setCurrentPresetId(id);
            setPityScopeChoice(() => (pityAll && Object.prototype.hasOwnProperty.call(pityAll, id) ? "preset" : "global"));
        }
    }
    function deletePreset(id) {
        setPresets((ps) => {
            const updated = ps.filter((p) => p.id !== id);
            try { saveToStorage("presets_v1", updated); } catch (err) { }
            const pity = { ...(pityAll || {}) };
            if (pity[id]) { delete pity[id]; setPityAll(pity); }
            const hard = { ...(pityHardHitsAll || {}) };
            if (hard[id]) { delete hard[id]; setPityHardHitsAll(hard); }
            return updated;
        });
        if (currentPresetId === id) setCurrentPresetId(null);
    }

    // history
    function addHistoryEntry(entry) {
        let newEntry;
        if (typeof entry === "string") {
            newEntry = { id: Date.now().toString(), decision: entry, timestamp: new Date().toISOString() };
        } else if (entry && typeof entry === "object" && entry.decision) {
            newEntry = {
                id: Date.now().toString(),
                decision: entry.decision,
                timestamp: new Date().toISOString(),
                dice: entry.dice ?? null,
                duration: entry.duration ?? null,
                method: entry.method ?? null,
            };
        } else {
            return;
        }
        setHistoryEntries((h) => [newEntry, ...h]);
    }

    function openHistoryModal() {
        const h = readHistory();
        setHistoryEntries(h || []);
        setHistoryPage(1);
        setShowHistoryModal(true);
    }
    function closeHistoryModal() { setShowHistoryModal(false); }
    function clearHistory() { setHistoryEntries([]); try { localStorage.removeItem("history_v1"); } catch (e) { } }
    const historyTotalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
    function historyPageSlice() { const start = (historyPage - 1) * HISTORY_PAGE_SIZE; return historyEntries.slice(start, start + HISTORY_PAGE_SIZE); }
    function goHistoryPrev() { setHistoryPage((p) => Math.max(1, p - 1)); }
    function goHistoryNext() { setHistoryPage((p) => Math.min(historyTotalPages, p + 1)); }

    function openSettingsModal(tab = "dice") {
        // prepare dice edit & pity edit snapshots
        setDiceEdit(diceSettings.map((d) => ({ num: d.num, sec: d.sec })));
        setDiceEditErrors({});
        setPityEdit({ ...pitySettings });
        const saved = (pitySettings && pitySettings.lastSelectedScope) ? pitySettings.lastSelectedScope : null;
        if (saved === "preset") {
            setPityScopeChoice(currentPresetId ? "preset" : "global");
        } else if (saved === "global") {
            setPityScopeChoice("global");
        } else {
            setPityScopeChoice(() => {
                try {
                    if (currentPresetId && pityAll && Object.prototype.hasOwnProperty.call(pityAll, currentPresetId)) {
                        return "preset";
                    }
                } catch (e) { /* ignore */ }
                return "global";
            });
        }
        setSettingsSaveError("");
        setActiveSettingsTab(tab === "pity" ? "pity" : "dice");
        setShowSettingsModal(true);
    }
    function closeSettingsModal() {
        setShowSettingsModal(false);
        setDiceEditErrors({});
        setSettingsSaveError("");
    }

    function validateDiceArray(arr) {
        const errors = {};
        const seen = new Map();
        arr.forEach((it, idx) => {
            const rowErr = {};
            if (it.num === "" || it.num === null || it.num === undefined || Number.isNaN(Number(it.num))) rowErr.num = "Number required";
            else {
                const n = Number(it.num);
                if (!Number.isInteger(n)) rowErr.num = "Must be integer";
                else if (n < 1 || n > 50) rowErr.num = "Must be 1–50";
                else {
                    if (seen.has(n)) {
                        rowErr.num = "Duplicate number";
                        const otherIdx = seen.get(n);
                        errors[otherIdx] = errors[otherIdx] || {};
                        errors[otherIdx].num = "Duplicate number";
                    } else seen.set(n, idx);
                }
            }
            if (it.sec === "" || it.sec === null || it.sec === undefined || Number.isNaN(Number(it.sec))) rowErr.sec = "Duration required";
            else {
                const s = Number(it.sec);
                if (s <= 0 || s > 60) rowErr.sec = "Must be >0 and ≤60";
            }
            if (Object.keys(rowErr).length) errors[idx] = rowErr;
        });
        return errors;
    }

    function onDiceEditChange(idx, field, value) {
        setDiceEdit((prev) => {
            const copy = prev.map((r) => ({ ...r }));
            if (field === "num") copy[idx].num = value === "" ? "" : Number(value);
            else if (field === "sec") copy[idx].sec = value === "" ? "" : Number(value);
            return copy;
        });
        setTimeout(() => {
            const errs = validateDiceArray(
                (function () {
                    const arr = diceEdit.map((r) => ({ ...r }));
                    arr[idx] = { ...arr[idx], [field]: field === "num" ? (value === "" ? "" : Number(value)) : (value === "" ? "" : Number(value)) };
                    return arr;
                })()
            );
            setDiceEditErrors(errs);
        }, 0);
    }

    function addDiceRow() {
        const used = new Set(diceEdit.map((d) => Number(d.num)).filter((n) => !Number.isNaN(n)));
        let next = 1;
        while (used.has(next) && next <= 50) next++;
        if (next > 50) { setSettingsSaveError("Cannot add more faces — all numbers 1..50 used."); return; }
        const newRow = { num: next, sec: 3 };
        setDiceEdit((p) => [...p, newRow]);
        setTimeout(() => { const errs = validateDiceArray([...diceEdit, newRow]); setDiceEditErrors(errs); }, 0);
    }
    function deleteDiceRow(idx) { if (diceEdit.length <= 2) return; setDiceEdit((p) => p.filter((_, i) => i !== idx)); setTimeout(() => { const arr = diceEdit.filter((_, i) => i !== idx); const errs = validateDiceArray(arr); setDiceEditErrors(errs); }, 0); }
    function resetDiceToDefaults() { setDiceEdit(DEFAULT_DICE.map((d) => ({ num: d.num, sec: d.sec }))); setDiceEditErrors({}); setSettingsSaveError(""); }

    function onPityEditChange(field, value) { setPityEdit((p) => ({ ...p, [field]: value })); }

    function resetPityGlobal() {
        const all = { ...(pityAll || {}) };
        all["global"] = {};
        for (const d of decisions) all["global"][decisionKeyFromText(d)] = 0;
        setPityAll(all);
        const hard = { ...(pityHardHitsAll || {}) };
        hard["global"] = [];
        setPityHardHitsAll(hard);
    }
    function resetPityCurrentPreset() {
        if (!currentPresetId) { setSettingsSaveError("No preset currently applied (cannot reset per-preset)."); return; }
        resetPityForScope(currentPresetId);
    }

    // Save both dice and pity settings when clicking "Save Settings"
    function saveSettingsModal() {
        // validate dice
        const diceErrs = validateDiceArray(diceEdit);
        setDiceEditErrors(diceErrs);
        if (Object.keys(diceErrs).length > 0) {
            setSettingsSaveError("Fix dice validation errors before saving.");
            return;
        }
        // validate pityEdit values
        const sInc = Number(pityEdit.softIncrement);
        const hardTh = Number(pityEdit.hardThreshold);
        const cap = Number(pityEdit.softMultiplierCap);
        if (!Number.isInteger(sInc) || sInc <= 0) { setSettingsSaveError("softIncrement must be integer > 0"); return; }
        if (!Number.isInteger(hardTh) || hardTh < 1) { setSettingsSaveError("hardThreshold must be integer ≥ 1"); return; }
        if (!Number.isInteger(cap) || cap < 1) { setSettingsSaveError("cap must be integer ≥ 1"); return; }

        // commit dice
        const normalized = diceEdit.map((r) => ({ num: Number(r.num), sec: Number(r.sec) })).sort((a, b) => a.num - b.num);
        setDiceSettings(normalized);

        // commit pity (if disabling pity and you want to also clear counters, see note)
        const cfg = {
            enabled: Boolean(pityEdit.enabled),
            softIncrement: sInc,
            hardThreshold: hardTh,
            softMultiplierCap: cap,
            autoResetWhenAllHardHit: Boolean(pityEdit.autoResetWhenAllHardHit),
        };
        const cfgWithScope = { ...cfg, lastSelectedScope: pityScopeChoice };
        if (pityScopeChoice === "preset" && !currentPresetId) {
            // guard: if there's no preset applied, fallback to global
            setPityScopeChoice("global");
        }
        setPitySettings(cfgWithScope);

        // close
        setShowSettingsModal(false);
    }

    // --- spin logic (dice-driven + pity) ---
    function stopSpin() {
        const wasRunning = spinRunningRef.current;
        if (spinTimeoutRef.current) { clearTimeout(spinTimeoutRef.current); spinTimeoutRef.current = null; }
        if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
        spinRunningRef.current = false;
        setIsRunning(false);
        if (wasRunning && activeIndex >= 0 && decisions[activeIndex]) {
            try {
                addHistoryEntry({
                    decision: decisions[activeIndex],
                    dice: diceRoll ?? null,
                    duration: diceDurationSec ?? null,
                    method: "manual-stop",
                });
                const scope = resolveScopeKey(pityScopeChoice);
                // Only update pity if it's enabled in saved settings
                if (pitySettings && pitySettings.enabled) {
                    applyPityUpdate(scope, decisions, activeIndex, "manual-stop");
                }
            } catch (err) { console.warn(err); }
        }
        setProgress(0);
    }

    function startDecision() {
        if (isRunning) return;
        if (decisions.length === 0) return;

        // pick a dice face for duration
        const roll = Math.floor(Math.random() * diceSettings.length);
        const face = diceSettings[roll];
        const rollNumber = face.num;
        const chosenSec = face.sec;
        setDiceRoll(rollNumber);
        setDiceDurationSec(chosenSec);
        const desiredMs = Math.max(300, Math.round(chosenSec * 1000));

        // pick final using pity
        const scope = resolveScopeKey(pityScopeChoice);
        const pityCountsForScope = (pityAll && pityAll[scope]) ? { ...pityAll[scope] } : {};
        const cfg = pitySettings || DEFAULT_PITY_SETTINGS;
        const pickResult = cfg.enabled ? pickWithPity(decisions, pityCountsForScope, cfg) : { chosenIndex: Math.floor(Math.random() * decisions.length), method: "none" };
        const finalChosenIndex = pickResult.chosenIndex;
        const pickMethod = pickResult.method;

        spinRunningRef.current = true;
        setIsRunning(true);
        setProgress(0);
        startTimeRef.current = Date.now();

        if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
        progressIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startTimeRef.current;
            const pct = Math.min(100, Math.round((elapsed / desiredMs) * 100));
            setProgress(pct);
            if (elapsed >= desiredMs) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
        }, 40);

        const baseDelay = 30;
        const estimatedFactor = 11;
        const totalTicks = Math.max(10, Math.round(desiredMs / (baseDelay * estimatedFactor)));
        const startFrom = activeIndex >= 0 && activeIndex < decisions.length ? activeIndex : 0;
        setActiveIndex(startFrom);
        let tick = 0;

        function step() {
            const progressRatio = tick / totalTicks;
            const multiplier = 1 + Math.pow(progressRatio, 3) * 40;
            const delay = Math.round(baseDelay * multiplier);

            spinTimeoutRef.current = setTimeout(() => {
                setActiveIndex((old) => (old + 1) % decisions.length);
                tick += 1;
                const elapsed = Date.now() - startTimeRef.current;

                if (tick <= totalTicks && spinRunningRef.current && elapsed < desiredMs) {
                    step();
                } else {
                    if (spinRunningRef.current) {
                        setActiveIndex(finalChosenIndex);
                        try {
                            // record history with dice info and method (soft-weight/hard-pity/none)
                            addHistoryEntry({
                                decision: decisions[finalChosenIndex],
                                dice: rollNumber,
                                duration: chosenSec,
                                method: pickMethod,
                            });
                        } catch (err) { console.warn(err); }

                        if (cfg && cfg.enabled) {
                            try {
                                applyPityUpdate(scope, decisions, finalChosenIndex, pickMethod);
                            } catch (err) {
                                console.warn(err);
                            }
                        } else {
                            // Pity disabled: do not mutate counters
                        }
                    }
                    if (spinTimeoutRef.current) { clearTimeout(spinTimeoutRef.current); spinTimeoutRef.current = null; }
                    if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
                    spinRunningRef.current = false;
                    setIsRunning(false);
                    setProgress(100);
                }
            }, delay);
        }

        step();
    }

    useEffect(() => {
        setPityAll((prev) => {
            try {
                if (!prev || typeof prev !== "object") {
                    return { global: {} };
                }
                if (!Object.prototype.hasOwnProperty.call(prev, "global")) {
                    return { ...prev, global: {} };
                }
                return prev;
            } catch (err) {
                console.warn("ensuring global pity scope failed:", err);
                return prev || { global: {} };
            }
        });
    }, []);

    const currentPresetName = currentPresetId ? (presets.find(p => p.id === currentPresetId)?.name || currentPresetId) : "";

    function restartFromStart() { setActiveIndex(decisions.length > 0 ? 0 : -1); }


    // --- render (keeps your exact layout) ---
    return (
        <Container fluid className="d-flex flex-column bg-light">
            {/* Main area - flexes to fill available space; card centered inside */}
            <main className="flex-grow-1 d-flex align-items-center justify-content-center w-100">
                <Row className="w-100 justify-content-center">
                    <Col xs={6} sm={7} md={10} lg={11} xl={12}>
                        {/* Constrain card height so footer doesn't force scroll on large monitors */}
                        <Card className="shadow-sm" style={{ maxHeight: '80vh', overflow: 'auto' }}>
                            <Card.Body>
                                <h3 className="text-center mb-3">Decision Simulator 🎲</h3>

                                {/* Dice info + progress (kept compact to preserve layout) */}
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                    <div>
                                        {diceRoll ? (
                                            <div className="small text-muted">
                                                Rolled: <Badge bg="info">{diceRoll}</Badge> → {diceDurationSec}s
                                            </div>
                                        ) : (
                                            <div className="small text-muted">Roll a dice when you start the spin</div>
                                        )}
                                    </div>
                                    <div style={{ width: 180 }}>
                                        <ProgressBar now={progress} label={progress ? `${progress}%` : ""} />
                                    </div>
                                </div>

                                {/* Input row */}
                                <Form onSubmit={addDecision}>
                                    <InputGroup>
                                        <Form.Control
                                            placeholder="Type a decision (e.g. 'Study for 1 hour', 'Play games')"
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            disabled={isRunning}
                                            aria-label="decision-input"
                                        />
                                        <Button
                                            type="submit"
                                            variant="primary"
                                            onClick={addDecision}
                                            disabled={isRunning || input.trim() === ""}
                                        >
                                            Add Decision
                                        </Button>
                                    </InputGroup>
                                </Form>

                                {/* Controls */}
                                <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-2 mt-3">
                                    <div className="d-flex gap-2">
                                        <Button
                                            variant={isRunning ? "secondary" : "success"}
                                            onClick={startDecision}
                                            disabled={isRunning || decisions.length === 0}
                                        >
                                            {isRunning ? "Picking..." : "Start Decision"}
                                        </Button>

                                        {isRunning ? (
                                            <Button variant="warning" onClick={stopSpin}>
                                                Stop
                                            </Button>
                                        ) : (
                                            <Button variant="outline-primary" onClick={restartFromStart} disabled={decisions.length === 0}>
                                                Restart From Start
                                            </Button>
                                        )}

                                        <Button
                                            variant="outline-danger"
                                            onClick={clearAll}
                                            disabled={decisions.length === 0 || isRunning}
                                            className="ms-2"
                                        >
                                            Clear All
                                        </Button>

                                        <Button variant="outline-secondary" onClick={() => openSavePresetModal()} disabled={decisions.length === 0}>
                                            Save Preset
                                        </Button>

                                        <Button variant="outline-info" onClick={() => setShowPresetModal(true)}>
                                            Presets ({presets.length})
                                        </Button>

                                        <Button variant="outline-dark" onClick={openHistoryModal} className="ms-1">
                                            History
                                        </Button>


                                        <Button variant="outline-secondary" onClick={() => openSettingsModal("dice")} className="ms-1">
                                            Settings
                                        </Button>
                                    </div>
                                </div>

                                {/* Decisions list - stacked column */}
                                <Row className="mt-3">
                                    <Col xs={12}>
                                        {decisions.length === 0 ? (
                                            <div className="text-center text-muted py-3">No decisions yet — add one above.</div>
                                        ) : (
                                            <ListGroup>
                                                {decisions.map((d, i) => {
                                                    const pk = decisionKeyFromText(d);
                                                    const scope = resolveScopeKey(pityScopeChoice);
                                                    const countsForScope = (pityAll && pityAll[scope]) ? pityAll[scope] : {};
                                                    const pityCount = Number(countsForScope[pk] || 0);
                                                    return (
                                                        <ListGroup.Item key={i} className="d-flex justify-content-between align-items-center" active={i === activeIndex}>
                                                            <div className="d-flex align-items-center gap-2" style={{ wordBreak: "break-word" }}>
                                                                <div style={{ minWidth: 8, minHeight: 8 }} />
                                                                <div>{d}</div>
                                                            </div>

                                                            <div className="d-flex align-items-center gap-2">
                                                                {pitySettings && pitySettings.enabled && (
                                                                    <div className="small text-muted">pity: <strong>{pityCount}</strong></div>
                                                                )}
                                                                {i === activeIndex && !isRunning && <Badge bg="warning" text="dark" className="ms-1">Selected</Badge>}
                                                                <Button size="sm" variant="outline-danger" onClick={() => removeDecision(i)} disabled={isRunning}>Remove</Button>
                                                            </div>
                                                        </ListGroup.Item>
                                                    );
                                                })}
                                            </ListGroup>
                                        )}
                                    </Col>
                                </Row>

                                {/* Small help text */}
                                <Row className="mt-3">
                                    <Col xs={12} className="text-muted small">
                                        <strong>Tip</strong>: The app will roll a dice and use the mapped duration. Save sets of
                                        decisions as presets to reuse them later. Presets are stored locally in your browser.
                                    </Col>
                                </Row>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            </main>

            {/* Presets Modal */}
            <Modal show={showPresetModal} onHide={closePresetModal} size="lg" scrollable>
                <Modal.Header closeButton>
                    <Modal.Title>Presets</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="d-flex gap-3 mb-3">
                        <Form.Control
                            placeholder="Preset name"
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                        />
                        <Button onClick={savePreset} disabled={decisions.length === 0}>
                            {editingPresetId ? "Save Changes" : "Save Current as Preset"}
                        </Button>
                    </div>

                    {presets.length === 0 ? (
                        <div className="text-muted">No presets saved yet.</div>
                    ) : (
                        <ListGroup>
                            {presets.map((p) => (
                                <ListGroup.Item key={p.id} className="d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong>{p.name}</strong>
                                        <div className="small text-muted">{Array.isArray(p.decisions) ? p.decisions.length : 0} items</div>
                                    </div>
                                    <div className="d-flex gap-2">
                                        <Button size="sm" onClick={() => applyPreset(p.id)}>
                                            Apply
                                        </Button>
                                        <Button size="sm" variant="outline-primary" onClick={() => { setPresetName(p.name); setEditingPresetId(p.id); }}>
                                            Edit
                                        </Button>
                                        <Button size="sm" variant="outline-danger" onClick={() => deletePreset(p.id)}>
                                            Delete
                                        </Button>
                                    </div>
                                </ListGroup.Item>
                            ))}
                        </ListGroup>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={closePresetModal}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* History Modal */}
            <Modal show={showHistoryModal} onHide={closeHistoryModal} size="lg">
                <Modal.Header closeButton><Modal.Title>Decision History</Modal.Title></Modal.Header>
                <Modal.Body>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <div className="small text-muted">Showing {historyEntries.length} entries</div>
                        <div className="d-flex gap-2">
                            <Button size="sm" variant="outline-secondary" onClick={goHistoryPrev} disabled={historyPage <= 1}>Prev</Button>
                            <div className="small align-self-center">Page {historyPage} / {historyTotalPages}</div>
                            <Button size="sm" variant="outline-secondary" onClick={goHistoryNext} disabled={historyPage >= historyTotalPages}>Next</Button>
                            <Button size="sm" variant="outline-danger" onClick={clearHistory} className="ms-2">Clear</Button>
                        </div>
                    </div>

                    {historyEntries.length === 0 ? <div className="text-muted">No history yet.</div> : (
                        <ListGroup>
                            {historyPageSlice().map((h) => (
                                <ListGroup.Item key={h.id} className="d-flex flex-column gap-2">
                                    <div className="d-flex justify-content-between">
                                        <div style={{ wordBreak: "break-word", fontWeight: 500 }}>{h.decision}</div>
                                        <div className="small text-muted">{new Date(h.timestamp).toLocaleString()}</div>
                                    </div>

                                    {/* Show dice + duration + method if present */}
                                    <div className="d-flex gap-3 align-items-center">
                                        {h.dice != null ? (
                                            <div className="small text-muted">Dice: <Badge bg="info">{h.dice}</Badge></div>
                                        ) : null}
                                        {h.duration != null ? (
                                            <div className="small text-muted">Duration: <strong>{h.duration}s</strong></div>
                                        ) : null}
                                        {h.method ? (
                                            <div className="small text-muted">Method: <em>{h.method}</em></div>
                                        ) : null}
                                    </div>
                                </ListGroup.Item>
                            ))}
                        </ListGroup>
                    )}
                </Modal.Body>
                <Modal.Footer><Button variant="secondary" onClick={closeHistoryModal}>Close</Button></Modal.Footer>
            </Modal>

            {/* Combined Settings Modal (Dice + Pity) with Tabs */}
            <Modal show={showSettingsModal} onHide={closeSettingsModal} size="lg" scrollable>
                <Modal.Header closeButton><Modal.Title>Settings</Modal.Title></Modal.Header>
                <Modal.Body>
                    <Tabs activeKey={activeSettingsTab} onSelect={(k) => setActiveSettingsTab(k)} className="mb-3">
                        {/* Dice tab */}
                        <Tab eventKey="dice" title="Dice">
                            <h6>Dice Faces</h6>
                            <p className="small text-muted">Edit dice faces and durations. Dice numbers must be unique (1–50). Durations 1–60 seconds. Minimum 2 faces.</p>
                            <div className="mb-2">
                                {diceEdit.length === 0 ? <div className="text-muted">No faces — add one.</div> : (
                                    <ListGroup>
                                        {diceEdit.map((row, idx) => {
                                            const rowErr = diceEditErrors[idx] || {};
                                            return (
                                                <ListGroup.Item key={idx} className="d-flex align-items-center gap-3">
                                                    <div style={{ width: 90 }}>
                                                        <Form.Group controlId={`dice-num-${idx}`}>
                                                            <Form.Label className="small mb-1">Dice number</Form.Label>
                                                            <Form.Control type="number" value={row.num} min={1} max={50} isInvalid={!!rowErr.num}
                                                                onChange={(e) => onDiceEditChange(idx, "num", e.target.value === "" ? "" : Number(e.target.value))} />
                                                            <div className="invalid-feedback" style={{ display: rowErr.num ? "block" : "none" }}>{rowErr.num}</div>
                                                        </Form.Group>
                                                    </div>

                                                    <div style={{ width: 140 }}>
                                                        <Form.Group controlId={`dice-sec-${idx}`}>
                                                            <Form.Label className="small mb-1">Duration (s)</Form.Label>
                                                            <Form.Control type="number" value={row.sec} min={1} max={60} isInvalid={!!rowErr.sec}
                                                                onChange={(e) => onDiceEditChange(idx, "sec", e.target.value === "" ? "" : Number(e.target.value))} />
                                                            <div className="invalid-feedback" style={{ display: rowErr.sec ? "block" : "none" }}>{rowErr.sec}</div>
                                                        </Form.Group>
                                                    </div>

                                                    <div className="ms-auto d-flex gap-2">
                                                        <Button size="sm" variant="outline-danger" onClick={() => deleteDiceRow(idx)} disabled={diceEdit.length <= 2}>Delete</Button>
                                                    </div>
                                                </ListGroup.Item>
                                            );
                                        })}
                                    </ListGroup>
                                )}
                            </div>

                            <div className="d-flex gap-2 mb-3">
                                <Button onClick={addDiceRow}>Add Face</Button>
                                <Button variant="outline-secondary" onClick={resetDiceToDefaults}>Reset to Defaults</Button>
                            </div>
                        </Tab>

                        {/* Pity tab */}
                        <Tab eventKey="pity" title="Pity (Beta)">
                            <h6>Pity Settings</h6>
                            <p className="small text-muted">Hybrid pity: soft-weight + hard guarantee. Toggle pity on/off, tune parameters, and reset counters.</p>

                            <Form>
                                <Form.Check type="switch" id="toggle-pity" label={`Pity enabled: ${pityEdit.enabled ? "ON" : "OFF"}`}
                                    checked={!!pityEdit.enabled} onChange={(e) => onPityEditChange("enabled", e.target.checked)} />

                                <div className="d-flex gap-3 mt-2 align-items-center">
                                    <Form.Group controlId="softIncrement">
                                        <Form.Label className="small mb-1">softIncrement</Form.Label>
                                        <Form.Control type="number" value={pityEdit.softIncrement} min={1} onChange={(e) => onPityEditChange("softIncrement", Number(e.target.value))} />
                                        <div className="small text-muted">Amount to add to weight per miss.</div>
                                    </Form.Group>

                                    <Form.Group controlId="hardThreshold">
                                        <Form.Label className="small mb-1">hardThreshold</Form.Label>
                                        <Form.Control type="number" value={pityEdit.hardThreshold} min={1} onChange={(e) => onPityEditChange("hardThreshold", Number(e.target.value))} />
                                        <div className="small text-muted">Guarantee after this many misses.</div>
                                    </Form.Group>

                                    <Form.Group controlId="cap">
                                        <Form.Label className="small mb-1">softMultiplierCap</Form.Label>
                                        <Form.Control type="number" value={pityEdit.softMultiplierCap} min={1} onChange={(e) => onPityEditChange("softMultiplierCap", Number(e.target.value))} />
                                        <div className="small text-muted">Max multiplier for soft-pity.</div>
                                    </Form.Group>
                                </div>

                                <Form.Check type="checkbox" id="autoReset" className="mt-2"
                                    label="Auto-reset pity when every face has been hit by a hard-pity"
                                    checked={!!pityEdit.autoResetWhenAllHardHit} onChange={(e) => onPityEditChange("autoResetWhenAllHardHit", e.target.checked)} />

                                <hr />

                                <h6>Pity Counters (scope)</h6>
                                <div className="d-flex gap-2 align-items-center mb-2">
                                    <Form.Check type="radio" id="scope-global" label="Global" checked={pityScopeChoice === "global"} onChange={() => setPityScopeChoice("global")} />
                                    <Form.Check type="radio" id="scope-preset" label={`Current preset (${currentPresetName || "none"})`} checked={pityScopeChoice === "preset"} onChange={() => setPityScopeChoice("preset")} disabled={!currentPresetId} />
                                </div>

                                <div className="small text-muted mb-2">Showing pity counters for: <strong>{pityScopeChoice === "global" ? "global" : currentPresetId}</strong></div>

                                <div style={{ maxHeight: 200, overflow: "auto" }}>
                                    <ListGroup>
                                        {decisions.length === 0 ? <ListGroup.Item className="text-muted">No decisions</ListGroup.Item> :
                                            decisions.map((d, idx) => {
                                                const key = decisionKeyFromText(d);
                                                const scopeKey = resolveScopeKey(pityScopeChoice);
                                                const map = (pityAll && pityAll[scopeKey]) ? pityAll[scopeKey] : {};
                                                const val = Number(map[key] || 0);
                                                return (
                                                    <ListGroup.Item key={idx} className="d-flex justify-content-between align-items-center">
                                                        <div style={{ wordBreak: "break-word" }}>{d}</div>
                                                        <div className="small text-muted">pity: <strong>{val}</strong></div>
                                                    </ListGroup.Item>
                                                );
                                            })}
                                    </ListGroup>
                                </div>

                                <div className="d-flex gap-2 mt-3">
                                    <Button variant="outline-danger" onClick={() => {
                                        const selectedScopeKey = resolveScopeKey(pityScopeChoice); resetPityForScope(selectedScopeKey);
                                    }}>Reset Pity Counters (scope)</Button>
                                    <Button variant="outline-secondary" onClick={() => { setPityAll({}); setPityHardHitsAll({}); }}>Reset All Pity</Button>
                                </div>
                            </Form>
                        </Tab>
                    </Tabs>

                    {settingsSaveError && <div className="mt-3 text-danger small">{settingsSaveError}</div>}
                </Modal.Body>

                <Modal.Footer>
                    <Button variant="secondary" onClick={closeSettingsModal}>Cancel</Button>
                    <Button variant="primary" onClick={saveSettingsModal}>Save Settings</Button>
                </Modal.Footer>
            </Modal>
            {/* Footer with author and GitHub link */}
            <footer className="pt-3 w-100 bg-white border-top mt-auto">
                <Container>
                    <div className="d-flex justify-content-center align-items-center gap-2 small">
                        <span className="text-muted">Made with 💖 by Andy</span>
                        <a
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-dark d-inline-flex align-items-center gap-1"
                            aria-label="GitHub"
                        >
                            <i className="bi bi-github" style={{ fontSize: 16 }} />
                            <span>GitHub</span>
                        </a>
                    </div>
                </Container>
            </footer>
        </Container>
    );
}
