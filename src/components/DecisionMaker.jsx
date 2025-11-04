import React, { useState, useEffect, useRef } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
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
} from "react-bootstrap";

// Default export so this file can be used as App or imported into App.js
export default function DecisionMakerApp() {
    const [input, setInput] = useState("");
    const [decisions, setDecisions] = useState([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [isRunning, setIsRunning] = useState(false);
    const [spinDuration, setSpinDuration] = useState(3); // seconds (user-configurable)

    // Presets (saved decision sets)
    const [presets, setPresets] = useState([]);
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [editingPresetId, setEditingPresetId] = useState(null);

    // Refs used to coordinate async timers and avoid stale closures
    const spinTimeoutRef = useRef(null);
    const spinRunningRef = useRef(false);

    // NEW: flag to avoid overwriting localStorage on first render
    const presetsLoadedRef = useRef(false);

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
    // Spin logic (using ref to avoid stale closures)
    // -----------------
    function stopSpin() {
        if (spinTimeoutRef.current) {
            clearTimeout(spinTimeoutRef.current);
            spinTimeoutRef.current = null;
        }
        spinRunningRef.current = false;
        setIsRunning(false);
    }

    function startDecision() {
        if (isRunning) return;
        if (decisions.length === 0) return;

        spinRunningRef.current = true;
        setIsRunning(true);

        const baseDelay = 30; // ms
        const estimatedFactor = 11; // heuristic
        const desiredMs = Math.max(300, Math.round(spinDuration * 1000));
        const totalTicks = Math.max(10, Math.round(desiredMs / (baseDelay * estimatedFactor)));

        const startFrom = activeIndex >= 0 && activeIndex < decisions.length ? activeIndex : 0;
        setActiveIndex(startFrom);

        let tick = 0;

        function step() {
            const progress = tick / totalTicks;
            const multiplier = 1 + Math.pow(progress, 3) * 40;
            const delay = Math.round(baseDelay * multiplier);

            spinTimeoutRef.current = setTimeout(() => {
                setActiveIndex((old) => (old + 1) % decisions.length);
                tick += 1;
                if (tick <= totalTicks && spinRunningRef.current) {
                    step();
                } else {
                    if (spinRunningRef.current) {
                        const final = Math.floor(Math.random() * decisions.length);
                        setActiveIndex(final);
                    }
                    spinRunningRef.current = false;
                    setIsRunning(false);
                    spinTimeoutRef.current = null;
                }
            }, delay);
        }

        step();
    }

    function restartFromStart() {
        setActiveIndex(decisions.length > 0 ? 0 : -1);
    }

    return (
        <Container fluid className="min-vh-100 d-flex justify-content-center align-items-center bg-light">
            <Row className="w-100 justify-content-center">
                <Col xs={6} sm={7} md={10} lg={11} xl={12}>
                    <Card className="shadow-sm">
                        <Card.Body>
                            <h3 className="text-center mb-3">Decision Maker</h3>

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

                                {/* Spin duration control */}
                                <div className="d-flex align-items-center gap-2 mt-2 mt-sm-0">
                                    <small className="text-muted">Spin duration (s):</small>
                                    <Form.Control
                                        type="number"
                                        value={spinDuration}
                                        onChange={(e) => setSpinDuration(Number(e.target.value))}
                                        min={0.5}
                                        step={0.5}
                                        style={{ width: 110 }}
                                        disabled={isRunning}
                                    />
                                    <small className="text-muted">(approx)</small>
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
                                    Tip: Use <strong>Spin duration</strong> to control how long the cycle feels. Save sets of
                                    decisions as presets to reuse them later. Presets are stored locally in your browser.
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

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
        </Container>
    );
}
