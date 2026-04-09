import { useState, useEffect } from "react";
import axios from "axios";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Download, Plus, Warning as WarningIcon, XCircle } from "@phosphor-icons/react";

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
    notes: ""
  });

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
      const transformed = res.data.map(item => ({
        time: new Date(item.timestamp).toLocaleTimeString(),
        current: item.current,
        normal: item.normal_current,
        warning: item.warning_current,
        motor: item.motor,
        status: item.status
      }));
      setChartData(transformed);
    } catch (e) {
      console.error("Error fetching monitoring data:", e);
      setChartData([]);
    } finally {
      setLoading(false);
    }
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
        notes: formData.notes || null
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
        notes: ""
      });
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
                  <p className="text-sm text-zinc-600 mt-1">{chartData.length} readings</p>
                )}
              </div>
              {selectedMachine && chartData.length > 0 && (
                <button
                  data-testid="export-btn"
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
                  <LineChart data={chartData}>
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
                    <ReferenceLine 
                      y={chartData[0]?.normal} 
                      stroke="#16A34A" 
                      strokeDasharray="5 5" 
                      label={{ value: 'Normal', position: 'right', fontSize: 10 }}
                    />
                    <ReferenceLine 
                      y={chartData[0]?.warning} 
                      stroke="#E11D48" 
                      strokeDasharray="5 5" 
                      label={{ value: 'Warning', position: 'right', fontSize: 10 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="current" 
                      stroke="#002FA7" 
                      strokeWidth={2}
                      dot={{ fill: '#002FA7', r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Current (A)"
                    />
                  </LineChart>
                </ResponsiveContainer>

                {/* Data Table */}
                <div className="mt-6 border-t border-zinc-200 pt-6">
                  <h4 className="text-sm font-medium text-zinc-900 mb-3">Recent Readings</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-200">
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Time</th>
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Motor</th>
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Current (A)</th>
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Normal (A)</th>
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Warning (A)</th>
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartData.slice(0, 15).map((row, idx) => (
                          <tr key={idx} className="even:bg-zinc-50/50 border-b border-zinc-100">
                            <td className="px-4 py-2 text-sm text-zinc-700">{row.time}</td>
                            <td className="px-4 py-2 text-sm text-zinc-700">{row.motor}</td>
                            <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right" data-numeric="true">{row.current}</td>
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
