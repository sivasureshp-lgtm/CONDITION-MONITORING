import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Download, Plus, Warning as WarningIcon, XCircle, Camera, Image as ImageIcon } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PLANT_CONFIG = {
  A: ["A1", "A2", "A3", "A4"],
  G: ["G1", "G2", "G3A", "G3B"],
  K: ["K1", "K2", "K3", "K4"],
  E: ["E1", "E2", "E3"]
};

const MOTOR_COMPONENTS = [
  "TubeRotation",
  "TubeHeight",
  "Feeder",
  "Shear1",
  "Shear2",
  "Gob Distributor",
  "Main Conveyor",
  "Ware Transfer",
  "Cross Conveyor",
  "Sec1 Invert",
  "Sec1 Takeout",
  "Sec1 Pusher Arm",
  "Sec1 Pusher Finger",
  "Sec2 Invert",
  "Sec2 Takeout",
  "Sec2 Pusher Arm",
  "Sec2 Pusher Finger"
];

const ConditionMonitoring = () => {
  const [selectedPlant, setSelectedPlant] = useState("A");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [chartData, setChartData] = useState([]);
  const [machineHealth, setMachineHealth] = useState([]);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  
  const [formData, setFormData] = useState({
    plant: "A",
    machine: "",
    motor: "",
    current: "",
    normal_current: "",
    warning_current: "",
    entry_source: "Field",
    verified_by: "",
    notes: "",
    photo_base64: null
  });
  const [photoPreview, setPhotoPreview] = useState(null);

  // ---- Recent Readings table: motor filter + how many rows to show ----
  const [motorFilter, setMotorFilter] = useState("ALL");
  const [rowLimit, setRowLimit] = useState(100); // 0 = show all

  // Reset the motor filter whenever a different machine is opened
  useEffect(() => {
    setMotorFilter("ALL");
  }, [selectedPlant, selectedMachine]);

  // Unique motor list for the dropdown (in the order they appear in the latest round)
  const motorOptions = useMemo(() => {
    const seen = [];
    chartData.forEach((r) => {
      if (r.motor && !seen.includes(r.motor)) seen.push(r.motor);
    });
    return seen;
  }, [chartData]);

  // Rows after the motor filter (newest first, same order as the API)
  const filteredRows = useMemo(
    () => (motorFilter === "ALL" ? chartData : chartData.filter((r) => r.motor === motorFilter)),
    [chartData, motorFilter]
  );

  // Rows actually drawn in the table
  const tableRows = rowLimit === 0 ? filteredRows : filteredRows.slice(0, rowLimit);

  // Chart reads left-to-right as oldest -> newest
  const trendData = useMemo(() => [...filteredRows].reverse(), [filteredRows]);

  // Only show Temperature / I2t columns when this machine actually has those values
  const hasTemp = filteredRows.some((r) => r.temperature !== null && r.temperature !== undefined);
  const hasI2t = filteredRows.some((r) => r.i2t !== null && r.i2t !== undefined);

  // Export the filtered rows as CSV (opens in Excel)
  const exportCsv = () => {
    const header = ["Time", "Motor", "Current (A)", "Temperature (C)", "I2t", "Normal (A)", "Warning (A)", "Status", "Source", "Photo URL"];
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")].concat(
      filteredRows.map((r) =>
        [r.time, r.motor, r.current, r.temperature, r.i2t, r.normal, r.warning, r.status, r.entry_source, r.photo]
          .map(esc)
          .join(",")
      )
    );
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const motorPart = motorFilter === "ALL" ? "all-motors" : motorFilter.replace(/\s+/g, "_");
    a.href = url;
    a.download = `${selectedPlant}_${selectedMachine}_${motorPart}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchActiveAlarms();
    if (selectedPlant) {
      fetchMachineHealth(selectedPlant);
    }
  }, [selectedPlant]);

  useEffect(() => {
    if (selectedPlant && selectedMachine) {
      fetchMonitoringData(selectedPlant, selectedMachine);
    }
  }, [selectedPlant, selectedMachine]);

  const fetchActiveAlarms = async () => {
    try {
      const res = await axios.get(`${API}/active-alarms`);
      setActiveAlarms(res.data);
    } catch (e) {
      console.error("Error fetching alarms:", e);
    }
  };

  const fetchMachineHealth = async (plant) => {
    try {
      const res = await axios.get(`${API}/machine-health/${plant}`);
      setMachineHealth(res.data);
    } catch (e) {
      console.error("Error fetching machine health:", e);
      setMachineHealth([]);
    }
  };

  const fetchMonitoringData = async (plant, machine) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/condition-monitoring/machine/${plant}/${machine}`);
      // Show date+time so readings from different days are distinguishable
      const transformed = res.data.map(item => ({
        time: new Date(item.timestamp).toLocaleDateString('en-IN', {day:'2-digit',month:'short'})
          + ' ' + new Date(item.timestamp).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',hour12:false}),
        current: typeof item.current === 'number' ? item.current : parseFloat(item.current) || null,
        temperature: typeof item.temperature === 'number' ? item.temperature : parseFloat(item.temperature) || null,
        i2t: typeof item.i2t === 'number' ? item.i2t : parseFloat(item.i2t) || null,
        normal: item.normal_current,
        warning: item.warning_current,
        motor: item.motor,
        status: item.status,
        photo: item.photo_url || item.photo || null,
        has_photo: item.has_photo || !!item.photo_url,
        verified: item.verified,
        entry_source: item.entry_source
      }));
      setChartData(transformed);
    } catch (e) {
      console.error("Error fetching monitoring data:", e);
      setChartData([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoCapture = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Resize so the longest side is at most 1200px, then compress to JPEG.
        // This cuts a typical 4000x3000 phone photo (5-8MB) down to ~150-300KB
        // before it ever reaches the server, preventing memory spikes on Render.
        const MAX_DIM = 1200;
        let { width, height } = img;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.7);
        setFormData({ ...formData, photo_base64: compressed });
        setPhotoPreview(compressed);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setFormData({ ...formData, photo_base64: null });
    setPhotoPreview(null);
  };

  const handleAddData = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API}/condition-monitoring`, {
        plant: formData.plant,
        machine: formData.machine,
        motor: formData.motor,
        current: parseFloat(formData.current),
        normal_current: parseFloat(formData.normal_current),
        warning_current: parseFloat(formData.warning_current),
        entry_source: formData.entry_source,
        verified_by: formData.verified_by || null,
        notes: formData.notes || null,
        photo_base64: formData.photo_base64
      });
      
      if (response.data.bulk_entry_flag) {
        alert("⚠️ Warning: Multiple entries detected in short time. Please verify data accuracy.");
      }
      
      setFormData({
        plant: "A",
        machine: "",
        motor: "",
        current: "",
        normal_current: "",
        warning_current: "",
        entry_source: "Field",
        verified_by: "",
        notes: "",
        photo_base64: null
      });
      setPhotoPreview(null);
      setShowAddForm(false);
      
      fetchActiveAlarms();
      if (selectedPlant) {
        fetchMachineHealth(selectedPlant);
      }
      if (selectedPlant === formData.plant && selectedMachine === formData.machine) {
        fetchMonitoringData(selectedPlant, selectedMachine);
      }
    } catch (e) {
      console.error("Error adding data:", e);
      alert(e.response?.data?.detail || "Failed to add monitoring data");
    }
  };

  const getHealthColor = (percent) => {
    if (percent >= 90) return "text-[#16A34A]";
    if (percent >= 70) return "text-yellow-700";
    return "text-[#E11D48]";
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-light tracking-tight text-zinc-950">Condition Monitoring</h1>
          <p className="text-sm text-zinc-700 mt-2">Motor current tracking and health analysis</p>
        </div>
        <button
          data-testid="add-data-btn"
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-[#002FA7] text-white hover:bg-[#002FA7]/90 px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none flex items-center space-x-2"
        >
          <Plus size={16} weight="bold" />
          <span>Add Reading</span>
        </button>
      </div>

      {/* Active Alarms */}
      {activeAlarms.length > 0 && (
        <div className="border-2 border-[#E11D48] bg-red-50 p-6 mb-6">
          <div className="flex items-center space-x-3 mb-4">
            <WarningIcon size={24} weight="fill" className="text-[#E11D48]" />
            <h3 className="text-lg font-medium tracking-tight text-[#E11D48]">Active Alarms - Action Required</h3>
          </div>
          <div className="space-y-2">
            {activeAlarms.map((alarm, idx) => (
              <div key={idx} className="flex items-center justify-between bg-white border border-red-200 p-3" data-testid="active-alarm">
                <div className="flex items-center space-x-4">
                  <XCircle size={20} weight="fill" className="text-[#E11D48]" />
                  <div>
                    <span className="text-sm font-medium text-zinc-950">{alarm.plant} - {alarm.machine} - {alarm.motor}</span>
                    <div className="flex items-center space-x-3 mt-1">
                      <span className="text-xs text-zinc-600">Current: <span className="font-mono font-bold text-[#E11D48]">{alarm.current}A</span></span>
                      <span className="text-xs text-zinc-600">Limit: <span className="font-mono">{alarm.warning_current}A</span></span>
                      <span className="text-xs text-zinc-500">{new Date(alarm.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Data Form */}
      {showAddForm && (
        <div className="border border-zinc-200 bg-white p-6 mb-6">
          <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Add Motor Current Reading</h3>
          <form onSubmit={handleAddData} className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Plant *</label>
              <select
                data-testid="form-plant-select"
                value={formData.plant}
                onChange={(e) => setFormData({ ...formData, plant: e.target.value, machine: "" })}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                required
              >
                {Object.keys(PLANT_CONFIG).map(p => (
                  <option key={p} value={p}>Plant {p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Machine *</label>
              <select
                data-testid="form-machine-select"
                value={formData.machine}
                onChange={(e) => setFormData({ ...formData, machine: e.target.value })}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                required
              >
                <option value="">Select</option>
                {PLANT_CONFIG[formData.plant]?.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Motor *</label>
              <select
                data-testid="form-motor-select"
                value={formData.motor}
                onChange={(e) => setFormData({ ...formData, motor: e.target.value })}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                required
              >
                <option value="">Select</option>
                {MOTOR_COMPONENTS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Current (A) *</label>
              <input
                data-testid="form-current-input"
                type="number"
                step="0.01"
                value={formData.current}
                onChange={(e) => setFormData({ ...formData, current: e.target.value })}
                placeholder="2.93"
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none font-mono"
                required
              />
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Normal (A) *</label>
              <input
                data-testid="form-normal-input"
                type="number"
                step="0.01"
                value={formData.normal_current}
                onChange={(e) => setFormData({ ...formData, normal_current: e.target.value })}
                placeholder="3.0"
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none font-mono"
                required
              />
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Warning (A) *</label>
              <input
                data-testid="form-warning-input"
                type="number"
                step="0.01"
                value={formData.warning_current}
                onChange={(e) => setFormData({ ...formData, warning_current: e.target.value })}
                placeholder="4.0"
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none font-mono"
                required
              />
            </div>

            <div className="md:col-span-6 border-t border-zinc-200 pt-4 mt-2">
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-3 block">
                📸 Verification Photo (Recommended)
              </label>
              <p className="text-xs text-zinc-600 mb-3">Add photo proof for field verification. Timestamp will be added automatically.</p>
              
              {!photoPreview ? (
                <div className="flex items-center space-x-3">
                  <label className="flex items-center space-x-2 px-4 py-2 border-2 border-dashed border-zinc-300 hover:border-[#002FA7] bg-white cursor-pointer transition-all duration-150 rounded-none">
                    <Camera size={20} weight="bold" className="text-[#002FA7]" />
                    <span className="text-sm text-zinc-700">Capture / Upload Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoCapture}
                      className="hidden"
                      data-testid="photo-input"
                    />
                  </label>
                  <span className="text-xs text-zinc-500">Camera or Gallery</span>
                </div>
              ) : (
                <div className="relative inline-block">
                  <img 
                    src={photoPreview} 
                    alt="Preview" 
                    className="w-64 h-48 object-cover border-2 border-[#002FA7]"
                  />
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="absolute top-2 right-2 bg-[#E11D48] text-white p-2 hover:bg-[#E11D48]/90 transition-all duration-150"
                  >
                    <XCircle size={20} weight="fill" />
                  </button>
                  <div className="mt-2 flex items-center space-x-2 text-xs">
                    <ImageIcon size={16} weight="fill" className="text-[#16A34A]" />
                    <span className="text-[#16A34A] font-medium">Photo ready - Timestamp will be added on submit</span>
                  </div>
                </div>
              )}
            </div>

            <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-zinc-200 pt-4 mt-2">
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Entry Source *</label>
                <select
                  data-testid="form-entry-source-select"
                  value={formData.entry_source}
                  onChange={(e) => setFormData({ ...formData, entry_source: e.target.value })}
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                  required
                >
                  <option value="Field">Field (On-site)</option>
                  <option value="Office">Office</option>
                </select>
                <p className="text-xs text-zinc-500 mt-1">Field entries are auto-verified</p>
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Verified By</label>
                <input
                  data-testid="form-verified-by-input"
                  type="text"
                  value={formData.verified_by}
                  onChange={(e) => setFormData({ ...formData, verified_by: e.target.value })}
                  placeholder="Technician name"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Notes</label>
                <input
                  data-testid="form-notes-input"
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>
            </div>

            <div className="md:col-span-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none"
              >
                Cancel
              </button>
              <button
                data-testid="submit-data-btn"
                type="submit"
                className="bg-[#16A34A] text-white hover:bg-[#16A34A]/90 px-6 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none"
              >
                Save Reading
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
        {/* Plant & Machine Selector */}
        <div className="col-span-1 md:col-span-3">
          {/* Plant Selector */}
          <div className="border border-zinc-200 bg-white p-6 mb-4">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Select Plant</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(PLANT_CONFIG).map((plant) => (
                <button
                  key={plant}
                  data-testid={`plant-btn-${plant}`}
                  onClick={() => {
                    setSelectedPlant(plant);
                    setSelectedMachine("");
                  }}
                  className={`px-4 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none border ${
                    selectedPlant === plant
                      ? 'border-[#002FA7] bg-[#002FA7] text-white'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                  }`}
                >
                  Plant {plant}
                </button>
              ))}
            </div>
          </div>

          {/* Machine Selector */}
          <div className="border border-zinc-200 bg-white p-6">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Select Machine</h3>
            <div className="space-y-2">
              {PLANT_CONFIG[selectedPlant]?.map((machine) => (
                <button
                  key={machine}
                  data-testid={`machine-btn-${machine}`}
                  onClick={() => setSelectedMachine(machine)}
                  className={`w-full text-left px-4 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none border ${
                    selectedMachine === machine
                      ? 'border-[#002FA7] bg-[#002FA7] text-white'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                  }`}
                >
                  {machine}
                </button>
              ))}
            </div>
          </div>

          {/* Machine Health Status */}
          {machineHealth.length > 0 && (
            <div className="border border-zinc-200 bg-white p-6 mt-4">
              <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Machine Health Status</h3>
              <div className="space-y-3">
                {machineHealth.map((health) => (
                  <div key={health.machine} className="border-l-2 border-[#002FA7] pl-3" data-testid={`health-${health.machine}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-zinc-950">{health.machine}</span>
                      <span className={`text-lg font-mono font-light ${getHealthColor(health.health_percent)}`}>
                        {health.health_percent}%
                      </span>
                    </div>
                    <div className="flex items-center space-x-3 text-xs">
                      <span className="text-[#16A34A]">OK: {health.ok}</span>
                      <span className="text-yellow-700">Warn: {health.warning}</span>
                      <span className="text-[#E11D48]">Alarm: {health.alarm}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chart & Data Display */}
        <div className="col-span-1 md:col-span-9">
          <div className="border border-zinc-200 bg-white p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-medium tracking-tight text-zinc-900">
                  {selectedMachine ? `${selectedPlant} - ${selectedMachine} Motor Current Trend` : 'Select a machine to view data'}
                </h3>
                {selectedMachine && (
                  <p className="text-sm text-zinc-600 mt-1">
                    {motorFilter === "ALL"
                      ? `${chartData.length} readings (all motors)`
                      : `${filteredRows.length} readings for ${motorFilter}`}
                  </p>
                )}
              </div>
              {selectedMachine && chartData.length > 0 && (
                <button
                  data-testid="export-btn"
                  onClick={exportCsv}
                  title="Download the readings shown below as a CSV file (opens in Excel)"
                  className="border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none flex items-center space-x-2"
                >
                  <Download size={16} weight="bold" />
                  <span>Export</span>
                </button>
              )}
            </div>

            {!selectedMachine ? (
              <div className="h-96 flex items-center justify-center">
                <p className="text-sm text-zinc-500">Select a plant and machine from the left panel</p>
              </div>
            ) : loading ? (
              <div className="h-96 flex items-center justify-center">
                <p className="text-sm text-zinc-600">Loading data...</p>
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-96 flex items-center justify-center">
                <p className="text-sm text-zinc-500">No monitoring data available for this machine</p>
              </div>
            ) : (
              <div data-testid="chart-container">
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 12, fill: '#71717a' }}
                      stroke="#a1a1aa"
                    />
                    <YAxis 
                      label={{ value: 'Current (A)', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#71717a' } }}
                      tick={{ fontSize: 12, fill: '#71717a', fontFamily: 'IBM Plex Mono, monospace' }}
                      stroke="#a1a1aa"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        border: '1px solid #e4e4e7',
                        borderRadius: 0,
                        fontSize: 12
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {/* Limit lines: only meaningful for ONE motor, so show them when a motor is selected */}
                    {motorFilter !== "ALL" && filteredRows[0]?.normal && (
                      <ReferenceLine
                        y={filteredRows[0].normal}
                        stroke="#16A34A"
                        strokeDasharray="5 5"
                        label={{ value: `Normal (${filteredRows[0].normal}A)`, position: 'right', fontSize: 10 }}
                      />
                    )}
                    {motorFilter !== "ALL" && filteredRows[0]?.warning && (
                      <ReferenceLine
                        y={filteredRows[0].warning}
                        stroke="#E11D48"
                        strokeDasharray="5 5"
                        label={{ value: `Warning (${filteredRows[0].warning}A)`, position: 'right', fontSize: 10 }}
                      />
                    )}
                    <Line 
                      type="monotone" 
                      dataKey="current" 
                      stroke={motorFilter === "ALL" ? "none" : "#002FA7"}
                      strokeWidth={motorFilter === "ALL" ? 0 : 2}
                      connectNulls
                      dot={{ fill: '#002FA7', r: motorFilter === "ALL" ? 4 : 3 }}
                      activeDot={{ r: 7 }}
                      name="Current (A)"
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>

                {/* Data Table */}
                <div className="mt-6 border-t border-zinc-200 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h4 className="text-sm font-medium text-zinc-900">
                      Recent Readings
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        showing {tableRows.length} of {filteredRows.length}
                      </span>
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-zinc-500">Motor</label>
                      <select
                        data-testid="motor-filter"
                        value={motorFilter}
                        onChange={(e) => setMotorFilter(e.target.value)}
                        className="border border-zinc-300 bg-white px-2 py-1 text-sm rounded-none"
                      >
                        <option value="ALL">All motors</option>
                        {motorOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <label className="text-xs text-zinc-500 ml-2">Rows</label>
                      <select
                        data-testid="row-limit"
                        value={rowLimit}
                        onChange={(e) => setRowLimit(Number(e.target.value))}
                        className="border border-zinc-300 bg-white px-2 py-1 text-sm rounded-none"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={250}>250</option>
                        <option value={0}>All</option>
                      </select>
                    </div>
                  </div>
                  {/* Fixed-height box: scroll inside it to see every row; header stays visible */}
                  <div className="overflow-auto max-h-[520px] border border-zinc-200" data-testid="readings-scroll">
                    <table className="w-full">
                      <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e4e4e7]">
                        <tr className="border-b border-zinc-200">
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Time</th>
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Motor</th>
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Current (A)</th>
                          {hasTemp && (
                            <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Temp (°C)</th>
                          )}
                          {hasI2t && (
                            <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">I²t</th>
                          )}
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Normal (A)</th>
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Warning (A)</th>
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Status</th>
                          <th className="text-center px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Photo</th>
                          <th className="text-center px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((row, idx) => (
                          <tr key={idx} className="even:bg-zinc-50/50 border-b border-zinc-100">
                            <td className="px-4 py-2 text-sm text-zinc-700 whitespace-nowrap">{row.time}</td>
                            <td className="px-4 py-2 text-sm text-zinc-700">{row.motor}</td>
                            <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right" data-numeric="true">{row.current ?? '-'}</td>
                            {hasTemp && (
                              <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right">{row.temperature ?? '-'}</td>
                            )}
                            {hasI2t && (
                              <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right">{row.i2t ?? '-'}</td>
                            )}
                            <td className="px-4 py-2 text-sm font-mono text-zinc-600 text-right">{row.normal}</td>
                            <td className="px-4 py-2 text-sm font-mono text-zinc-600 text-right">{row.warning}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wider rounded-none ${
                                row.status === 'OK' ? 'bg-green-50 text-green-700' :
                                row.status === 'Warning' ? 'bg-yellow-50 text-yellow-800' :
                                'bg-red-50 text-red-700'
                              }`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              {row.has_photo ? (
                                <button
                                  onClick={() => window.open(row.photo, '_blank')}
                                  className="inline-flex items-center space-x-1 text-[#002FA7] hover:text-[#002FA7]/80 transition-colors"
                                  title="View photo with timestamp"
                                >
                                  <Camera size={18} weight="fill" />
                                  <span className="text-xs">View</span>
                                </button>
                              ) : (
                                <span className="text-xs text-zinc-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wider rounded-none ${
                                row.entry_source === 'Field' ? 'bg-[#002FA7] text-white' :
                                'bg-zinc-200 text-zinc-700'
                              }`}>
                                {row.entry_source || 'N/A'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConditionMonitoring;
