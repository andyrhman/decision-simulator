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
} from "react-bootstrap";

const GITHUB_URL = "https://github.com/andyrhman";
const DICE_STORAGE_KEY = "dice_v1";

const DEFAULT_DICE = [
    { num: 1, sec: 3 },
    { num: 2, sec: 5 },
    { num: 3, sec: 7 },
    { num: 4, sec: 8 },
    { num: 5, sec: 9 },
    { num: 6, sec: 10 },
];

export default function DecisionMakerApp() {
    function readFromStorage(key, fallback = []) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed;
        } catch (err) {
            console.warn("readFromStorage error", key, err);
            return fallback;
        }
    }
    function readPresetsFromStorage() {
        return readFromStorage("presets_v1", []);
    }
    function readDecisionsFromStorage() {
        return readFromStorage("decisions_v1", []);
    }
    function readHistoryFromStorage() {
        return readFromStorage("history_v1", []);
    }
    function readDiceFromStorage() {
        const d = readFromStorage(DICE_STORAGE_KEY, null);
        // Expect an array of {num, sec}. Fallback to default if structure invalid.
        if (Array.isArray(d) && d.every((x) => x && typeof x.num === "number" && typeof x.sec === "number")) {
            return d;
        }
        return DEFAULT_DICE.slice();
    }

    // --- state ---
    const [input, setInput] = useState("");
    const [decisions, setDecisions] = useState(() => readDecisionsFromStorage());
    const [activeIndex, setActiveIndex] = useState(-1);
    const [isRunning, setIsRunning] = useState(false);

    // presets
    const [presets, setPresets] = useState(() => readPresetsFromStorage());
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [editingPresetId, setEditingPresetId] = useState(null);

    // history
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyEntries, setHistoryEntries] = useState(() => readHistoryFromStorage());
    const [historyPage, setHistoryPage] = useState(1);
    const HISTORY_PAGE_SIZE = 10;

    // dice / settings
    const [diceSettings, setDiceSettings] = useState(() => readDiceFromStorage());
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    // UI dice/progress
    const [diceRoll, setDiceRoll] = useState(null);
    const [diceDurationSec, setDiceDurationSec] = useState(null);
    const [progress, setProgress] = useState(0);

    // refs
    const spinTimeoutRef = useRef(null);
    const progressIntervalRef = useRef(null);
    const startTimeRef = useRef(null);
    const spinRunningRef = useRef(false);
    const presetsLoadedRef = useRef(false);

    // --- normalize/load on mount ---
    useEffect(() => {
        try {
            const p = localStorage.getItem("presets_v1");
            if (p) {
                const parsed = JSON.parse(p);
                if (Array.isArray(parsed)) setPresets(parsed);
                else if (parsed && typeof parsed === "object") {
                    setPresets([parsed]);
                    try {
                        localStorage.setItem("presets_v1", JSON.stringify([parsed]));
                    } catch (err) { }
                }
            }
        } catch (e) {
            console.warn(e);
        } finally {
            presetsLoadedRef.current = true;
        }
    }, []);

    // autosave decisions/presets/history/diceSettings
    useEffect(() => {
        try {
            localStorage.setItem("decisions_v1", JSON.stringify(decisions));
        } catch (e) { }
    }, [decisions]);
    useEffect(() => {
        if (!presetsLoadedRef.current) return;
        try {
            localStorage.setItem("presets_v1", JSON.stringify(presets));
        } catch (e) { }
    }, [presets]);
    useEffect(() => {
        try {
            localStorage.setItem("history_v1", JSON.stringify(historyEntries));
        } catch (e) { }
    }, [historyEntries]);
    useEffect(() => {
        try {
            localStorage.setItem(DICE_STORAGE_KEY, JSON.stringify(diceSettings));
        } catch (e) { }
    }, [diceSettings]);

    // cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            spinRunningRef.current = false;
        };
    }, []);

    // --- helpers: decisions/presets/history ---
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
    function clearAll() {
        setDecisions([]);
        setActiveIndex(-1);
    }

    function openSavePresetModal(editId = null) {
        if (editId) {
            const p = presets.find((x) => x.id === editId);
            if (p) {
                setPresetName(p.name);
                setEditingPresetId(editId);
            }
        } else {
            setPresetName("");
            setEditingPresetId(null);
        }
        setShowPresetModal(true);
    }
    function closePresetModal() {
        setShowPresetModal(false);
        setPresetName("");
        setEditingPresetId(null);
    }
    function savePreset() {
        const snapshot = decisions.slice();
        const nameTrim = presetName.trim() || `Preset ${new Date().toLocaleString()}`;
        if (editingPresetId) {
            setPresets((ps) => {
                const updated = ps.map((p) => (p.id === editingPresetId ? { ...p, name: nameTrim, decisions: snapshot } : p));
                try {
                    localStorage.setItem("presets_v1", JSON.stringify(updated));
                } catch (err) { }
                return updated;
            });
        } else {
            const id = Date.now().toString();
            setPresets((ps) => {
                const updated = [...ps, { id, name: nameTrim, decisions: snapshot }];
                try {
                    localStorage.setItem("presets_v1", JSON.stringify(updated));
                } catch (err) { }
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
        }
    }
    function deletePreset(id) {
        setPresets((ps) => {
            const updated = ps.filter((p) => p.id !== id);
            try {
                localStorage.setItem("presets_v1", JSON.stringify(updated));
            } catch (err) { }
            return updated;
        });
    }

    // --- history helpers ---
    function addHistoryEntry(decisionText) {
        if (!decisionText) return;
        const entry = { id: Date.now().toString(), decision: decisionText, timestamp: new Date().toISOString() };
        setHistoryEntries((h) => [entry, ...h]);
    }
    function openHistoryModal() {
        const h = readHistoryFromStorage();
        setHistoryEntries(h);
        setHistoryPage(1);
        setShowHistoryModal(true);
    }
    function closeHistoryModal() {
        setShowHistoryModal(false);
    }
    function clearHistory() {
        setHistoryEntries([]);
        try {
            localStorage.removeItem("history_v1");
        } catch (e) { }
    }

    const historyTotalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
    function historyPageSlice() {
        const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
        return historyEntries.slice(start, start + HISTORY_PAGE_SIZE);
    }
    function goHistoryPrev() {
        setHistoryPage((p) => Math.max(1, p - 1));
    }
    function goHistoryNext() {
        setHistoryPage((p) => Math.min(historyTotalPages, p + 1));
    }

    // --- settings modal (local edit state & validation) ---
    // We'll keep an independent edit copy while modal is open.
    const [diceEdit, setDiceEdit] = useState([]);
    const [diceEditErrors, setDiceEditErrors] = useState({}); // { idx: { num: 'msg', sec: 'msg' } }
    const [settingsSaveError, setSettingsSaveError] = useState("");

    function openSettingsModal() {
        // copy current dice settings into editable array
        setDiceEdit(diceSettings.map((d) => ({ num: d.num, sec: d.sec })));
        setDiceEditErrors({});
        setSettingsSaveError("");
        setShowSettingsModal(true);
    }
    function closeSettingsModal() {
        setShowSettingsModal(false);
        setDiceEditErrors({});
        setSettingsSaveError("");
    }

    // validation function returns errors object
    function validateDiceArray(arr) {
        const errors = {};
        // numbers must be integer 1..50, sec must be number 1..60
        // numbers unique
        const seen = new Map();
        arr.forEach((it, idx) => {
            const rowErr = {};
            // num validation
            if (it.num === "" || it.num === null || it.num === undefined || Number.isNaN(Number(it.num))) {
                rowErr.num = "Number required";
            } else {
                const n = Number(it.num);
                if (!Number.isInteger(n)) rowErr.num = "Must be integer";
                else if (n < 1 || n > 50) rowErr = { ...rowErr, num: "Must be 1–50" };
                else {
                    if (seen.has(n)) {
                        // mark duplicate on both entries
                        rowErr.num = "Duplicate number";
                        const otherIdx = seen.get(n);
                        errors[otherIdx] = errors[otherIdx] || {};
                        errors[otherIdx].num = "Duplicate number";
                    } else seen.set(n, idx);
                }
            }
            // sec validation
            if (it.sec === "" || it.sec === null || it.sec === undefined || Number.isNaN(Number(it.sec))) {
                rowErr.sec = "Duration required";
            } else {
                const s = Number(it.sec);
                if (s <= 0 || s > 60) rowErr.sec = "Must be >0 and ≤60";
            }
            if (Object.keys(rowErr).length) errors[idx] = rowErr;
        });
        // global constraint: at least 2 faces
        if (arr.length < 2) {
            setSettingsSaveError("Dice must have at least 2 faces.");
        } else {
            // reset only if no other global error
            setSettingsSaveError("");
        }
        return errors;
    }

    function onDiceEditChange(idx, field, value) {
        setDiceEdit((prev) => {
            const copy = prev.map((r) => ({ ...r }));
            if (field === "num") copy[idx].num = value === "" ? "" : Number(value);
            else if (field === "sec") copy[idx].sec = value === "" ? "" : Number(value);
            return copy;
        });
        // revalidate on change
        setTimeout(() => {
            const errs = validateDiceArray(
                (idx === undefined ? diceEdit : // fallback in case state not updated yet
                    // create the prospective array with this change applied
                    (function () {
                        const arr = diceEdit.map((r) => ({ ...r }));
                        arr[idx] = { ...arr[idx], [field]: field === "num" ? (value === "" ? "" : Number(value)) : (value === "" ? "" : Number(value)) };
                        return arr;
                    })())
            );
            setDiceEditErrors(errs);
        }, 0);
    }

    function addDiceRow() {
        // find smallest unused number from 1..50
        const used = new Set(diceEdit.map((d) => Number(d.num)).filter((n) => !Number.isNaN(n)));
        let next = 1;
        while (used.has(next) && next <= 50) next++;
        if (next > 50) {
            setSettingsSaveError("Cannot add more faces — all numbers 1..50 used.");
            return;
        }
        const newRow = { num: next, sec: 3 };
        setDiceEdit((p) => [...p, newRow]);
        setTimeout(() => {
            const errs = validateDiceArray([...diceEdit, newRow]);
            setDiceEditErrors(errs);
        }, 0);
    }

    function deleteDiceRow(idx) {
        if (diceEdit.length <= 2) return; // guarded UI will prevent, but double-check
        setDiceEdit((p) => p.filter((_, i) => i !== idx));
        setTimeout(() => {
            const arr = diceEdit.filter((_, i) => i !== idx);
            const errs = validateDiceArray(arr);
            setDiceEditErrors(errs);
        }, 0);
    }

    function resetDiceToDefaults() {
        setDiceEdit(DEFAULT_DICE.map((d) => ({ num: d.num, sec: d.sec })));
        setDiceEditErrors({});
        setSettingsSaveError("");
    }

    function saveSettingsFromModal() {
        // validate
        const errs = validateDiceArray(diceEdit);
        setDiceEditErrors(errs);
        if (Object.keys(errs).length > 0 || diceEdit.length < 2) {
            setSettingsSaveError("Fix validation errors before saving.");
            return;
        }
        // normalize: sort by dice number ascending (optional)
        const normalized = diceEdit
            .map((r) => ({ num: Number(r.num), sec: Number(r.sec) }))
            .sort((a, b) => a.num - b.num);
        setDiceSettings(normalized);
        try {
            localStorage.setItem(DICE_STORAGE_KEY, JSON.stringify(normalized));
        } catch (e) { }
        setShowSettingsModal(false);
    }

    // --- spin logic (dice-driven) ---
    function stopSpin() {
        const wasRunning = spinRunningRef.current;
        if (spinTimeoutRef.current) {
            clearTimeout(spinTimeoutRef.current);
            spinTimeoutRef.current = null;
        }
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        spinRunningRef.current = false;
        setIsRunning(false);
        if (wasRunning && activeIndex >= 0 && decisions[activeIndex]) {
            try {
                addHistoryEntry(decisions[activeIndex]);
            } catch (err) { }
        }
        setProgress(0);
    }

    function startDecision() {
        if (isRunning) return;
        if (decisions.length === 0) return;

        // pick a random face from current diceSettings
        const faces = Array.isArray(diceSettings) && diceSettings.length > 0 ? diceSettings : DEFAULT_DICE;
        const idx = Math.floor(Math.random() * faces.length);
        const face = faces[idx];
        const rollNumber = face.num;
        const chosenSec = face.sec;

        setDiceRoll(rollNumber);
        setDiceDurationSec(chosenSec);

        const desiredMs = Math.max(300, Math.round(chosenSec * 1000));

        spinRunningRef.current = true;
        setIsRunning(true);
        setProgress(0);
        startTimeRef.current = Date.now();

        // progress updater
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        progressIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startTimeRef.current;
            const pct = Math.min(100, Math.round((elapsed / desiredMs) * 100));
            setProgress(pct);
            if (elapsed >= desiredMs) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        }, 40);

        // spin animation ticks
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
                        const final = Math.floor(Math.random() * decisions.length);
                        setActiveIndex(final);
                        try {
                            addHistoryEntry(decisions[final]);
                        } catch (err) { }
                    }
                    if (spinTimeoutRef.current) {
                        clearTimeout(spinTimeoutRef.current);
                        spinTimeoutRef.current = null;
                    }
                    if (progressIntervalRef.current) {
                        clearInterval(progressIntervalRef.current);
                        progressIntervalRef.current = null;
                    }
                    spinRunningRef.current = false;
                    setIsRunning(false);
                    setProgress(100);
                }
            }, delay);
        }

        step();
    }

    function restartFromStart() {
        setActiveIndex(decisions.length > 0 ? 0 : -1);
    }


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

                                        <Button variant="outline-secondary" onClick={openSettingsModal} className="ms-1">
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
                                                {decisions.map((d, i) => (
                                                    <ListGroup.Item
                                                        key={i}
                                                        className="d-flex justify-content-between align-items-center"
                                                        active={i === activeIndex}
                                                    >
                                                        <div className="d-flex align-items-center gap-2">
                                                            <div style={{ minWidth: 8, minHeight: 8 }}>
                                                                {/* small bullet (optional) */}
                                                            </div>
                                                            <div>{d}</div>
                                                        </div>

                                                        <div className="d-flex align-items-center gap-2">
                                                            {i === activeIndex && !isRunning && (
                                                                <Badge bg="warning" text="dark">
                                                                    Selected
                                                                </Badge>
                                                            )}
                                                            <Button
                                                                size="sm"
                                                                variant="outline-danger"
                                                                onClick={() => removeDecision(i)}
                                                                disabled={isRunning}
                                                            >
                                                                Remove
                                                            </Button>
                                                        </div>
                                                    </ListGroup.Item>
                                                ))}
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
            <Modal show={showPresetModal} onHide={closePresetModal} size="lg">
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
                <Modal.Header closeButton>
                    <Modal.Title>Decision History</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <div className="small text-muted">Showing {historyEntries.length} entries</div>
                        <div className="d-flex gap-2">
                            <Button size="sm" variant="outline-secondary" onClick={goHistoryPrev} disabled={historyPage <= 1}>
                                Prev
                            </Button>
                            <div className="small align-self-center">Page {historyPage} / {historyTotalPages}</div>
                            <Button size="sm" variant="outline-secondary" onClick={goHistoryNext} disabled={historyPage >= historyTotalPages}>
                                Next
                            </Button>
                            <Button size="sm" variant="outline-danger" onClick={clearHistory} className="ms-2">Clear</Button>
                        </div>
                    </div>

                    {historyEntries.length === 0 ? (
                        <div className="text-muted">No history yet.</div>
                    ) : (
                        <ListGroup>
                            {historyPageSlice().map((h) => (
                                <ListGroup.Item key={h.id} className="d-flex justify-content-between align-items-center">
                                    <div>
                                        <div style={{ wordBreak: 'break-word' }}>{h.decision}</div>
                                        <div className="small text-muted">{new Date(h.timestamp).toLocaleString()}</div>
                                    </div>
                                </ListGroup.Item>
                            ))}
                        </ListGroup>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={closeHistoryModal}>Close</Button>
                </Modal.Footer>
            </Modal>

            {/* Settings Modal */}
            <Modal show={showSettingsModal} onHide={closeSettingsModal} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Dice Settings</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="small text-muted">Edit dice faces and their durations. Dice numbers must be unique (1–50). Durations 1–60 seconds. Minimum 2 faces.</p>

                    {/* table-like list */}
                    <div className="mb-2">
                        {diceEdit.length === 0 ? (
                            <div className="text-muted">No faces — add one.</div>
                        ) : (
                            <ListGroup>
                                {diceEdit.map((row, idx) => {
                                    const rowErr = diceEditErrors[idx] || {};
                                    return (
                                        <ListGroup.Item key={idx} className="d-flex align-items-center gap-3">
                                            <div style={{ width: 90 }}>
                                                <Form.Group controlId={`dice-num-${idx}`}>
                                                    <Form.Label className="small mb-1">Dice number</Form.Label>
                                                    <Form.Control
                                                        type="number"
                                                        value={row.num}
                                                        min={1}
                                                        max={50}
                                                        isInvalid={!!rowErr.num}
                                                        onChange={(e) => onDiceEditChange(idx, "num", e.target.value === "" ? "" : Number(e.target.value))}
                                                    />
                                                    <div className="invalid-feedback" style={{ display: rowErr.num ? "block" : "none" }}>
                                                        {rowErr.num}
                                                    </div>
                                                </Form.Group>
                                            </div>

                                            <div style={{ width: 140 }}>
                                                <Form.Group controlId={`dice-sec-${idx}`}>
                                                    <Form.Label className="small mb-1">Duration (s)</Form.Label>
                                                    <Form.Control
                                                        type="number"
                                                        value={row.sec}
                                                        min={1}
                                                        max={60}
                                                        isInvalid={!!rowErr.sec}
                                                        onChange={(e) => onDiceEditChange(idx, "sec", e.target.value === "" ? "" : Number(e.target.value))}
                                                    />
                                                    <div className="invalid-feedback" style={{ display: rowErr.sec ? "block" : "none" }}>
                                                        {rowErr.sec}
                                                    </div>
                                                </Form.Group>
                                            </div>

                                            <div className="ms-auto d-flex gap-2">
                                                <Button size="sm" variant="outline-danger" onClick={() => deleteDiceRow(idx)} disabled={diceEdit.length <= 2}>
                                                    Delete
                                                </Button>
                                            </div>
                                        </ListGroup.Item>
                                    );
                                })}
                            </ListGroup>
                        )}
                    </div>

                    <div className="d-flex gap-2">
                        <Button onClick={addDiceRow}>Add Face</Button>
                        <Button variant="outline-secondary" onClick={resetDiceToDefaults}>Reset to Defaults</Button>
                    </div>

                    {settingsSaveError && <div className="mt-3 text-danger small">{settingsSaveError}</div>}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={closeSettingsModal}>Cancel</Button>
                    <Button variant="primary" onClick={saveSettingsFromModal}>Save Settings</Button>
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
