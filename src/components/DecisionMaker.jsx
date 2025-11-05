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

// Default export so this file can be used as App or imported into App.js
export default function DecisionMakerApp() {
    // Helper to safely parse localStorage value for an array or object
    function readPresetsFromStorage() {
        try {
            const raw = localStorage.getItem("presets_v1");
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === "object") return [parsed];
        } catch (err) {
            console.warn("readPresetsFromStorage error:", err);
        }
        return [];
    }

    function readDecisionsFromStorage() {
        try {
            const raw = localStorage.getItem("decisions_v1");
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (err) {
            console.warn("readDecisionsFromStorage error:", err);
        }
        return [];
    }

    const [input, setInput] = useState("");
    const [decisions, setDecisions] = useState(() => readDecisionsFromStorage());
    const [activeIndex, setActiveIndex] = useState(-1);
    const [isRunning, setIsRunning] = useState(false);

    // Presets (saved decision sets)
    const [presets, setPresets] = useState(() => readPresetsFromStorage());
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [editingPresetId, setEditingPresetId] = useState(null);

    // Refs used to coordinate async timers and avoid stale closures
    const spinTimeoutRef = useRef(null);
    const spinRunningRef = useRef(false);

    // Progress & dice refs
    const progressIntervalRef = useRef(null);
    const startTimeRef = useRef(null);

    // NEW: flag to avoid overwriting localStorage on first render
    const presetsLoadedRef = useRef(false);

    // Dice/progress state
    const [diceRoll, setDiceRoll] = useState(null); // 1..6
    const [diceDurationSec, setDiceDurationSec] = useState(null); // seconds
    const [progress, setProgress] = useState(0); // 0..100

    // Load saved decisions & presets from localStorage once (with validation)
    useEffect(() => {
        try {
            const raw = localStorage.getItem("decisions_v1");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) setDecisions(parsed);
            }
        } catch (e) {
            console.warn("Failed to load decisions:", e);
        }

        try {
            const p = localStorage.getItem("presets_v1");
            if (p) {
                const parsed = JSON.parse(p);
                // Accept either an array of presets or a single preset object (backward compatibility)
                if (Array.isArray(parsed)) {
                    setPresets(parsed);
                } else if (parsed && typeof parsed === "object") {
                    // If someone accidentally saved a single object (you showed this in your log),
                    // convert it into an array so we don't drop it.
                    setPresets([parsed]);
                    // Also immediately re-write as array to normalize the stored format.
                    try {
                        localStorage.setItem("presets_v1", JSON.stringify([parsed]));
                    } catch (err) {
                        console.warn("Failed to normalize presets in storage:", err);
                    }
                }
            }
        } catch (e) {
            console.warn("Failed to load presets:", e);
        } finally {
            // mark presets as loaded so the saving effect won't overwrite them immediately
            presetsLoadedRef.current = true;
        }
    }, []);

    // Save decisions to localStorage on changes
    useEffect(() => {
        try {
            localStorage.setItem("decisions_v1", JSON.stringify(decisions));
        } catch (e) {
            console.warn("Failed to save decisions:", e);
        }
    }, [decisions]);

    // Keep presets persisted, but avoid writing during initial mount before load completes.
    useEffect(() => {
        if (!presetsLoadedRef.current) return;
        try {
            localStorage.setItem("presets_v1", JSON.stringify(presets));
        } catch (e) {
            console.warn("Failed to save presets:", e);
        }
    }, [presets]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            spinRunningRef.current = false;
        };
    }, []);

    function addDecision(e) {
        e?.preventDefault();
        const trimmed = input.trim();
        if (!trimmed) return;
        setDecisions((d) => [...d, trimmed]);
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

    // -----------------
    // Preset functions (robust persistence)
    // -----------------
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
        // clone the decisions array to make a snapshot (so future changes don't mutate preset)
        const snapshot = decisions.slice();
        const nameTrim = presetName.trim() || `Preset ${new Date().toLocaleString()}`;

        if (editingPresetId) {
            setPresets((ps) => {
                const updated = ps.map((p) => (p.id === editingPresetId ? { ...p, name: nameTrim, decisions: snapshot } : p));
                try {
                    // immediate write in case the user reloads right after saving
                    localStorage.setItem("presets_v1", JSON.stringify(updated));
                } catch (err) {
                    console.warn("Failed to write presets immediately:", err);
                }
                return updated;
            });
        } else {
            const id = Date.now().toString();
            setPresets((ps) => {
                const updated = [...ps, { id, name: nameTrim, decisions: snapshot }];
                try {
                    localStorage.setItem("presets_v1", JSON.stringify(updated));
                } catch (err) {
                    console.warn("Failed to write presets immediately:", err);
                }
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
            } catch (err) {
                console.warn("Failed to write presets immediately:", err);
            }
            return updated;
        });
    }

    // -----------------
    // Dice mapping
    // -----------------
    const DICE_DURATIONS = {
        1: 3,
        2: 5,
        3: 7,
        4: 8,
        5: 9,
        6: 10,
    };

    // -----------------
    // Spin logic (dice-driven) + progress
    // -----------------
    function stopSpin() {
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
        setProgress(0);
        // keep diceRoll/diceDurationSec visible for feedback
    }

    function startDecision() {
        if (isRunning) return;
        if (decisions.length === 0) return;

        // roll dice
        const roll = Math.floor(Math.random() * 6) + 1;
        const chosenSec = DICE_DURATIONS[roll];
        setDiceRoll(roll);
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

        // spin animation ticks (accelerate then decelerate)
        const baseDelay = 30; // ms
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
                        // final pick: random index (reduces deterministic bias)
                        const final = Math.floor(Math.random() * decisions.length);
                        setActiveIndex(final);
                    }
                    // cleanup
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
