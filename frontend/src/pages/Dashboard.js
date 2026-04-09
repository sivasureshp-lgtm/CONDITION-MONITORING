import { useEffect, useState } from "react";
import axios from "axios";
import { GearSix, Files, ChatCircleDots, TrendUp, Warning } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Dashboard = () => {
  const [plantHealth, setPlantHealth] = useState([]);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const requests = [
        axios.get(`${API}/plant-health`),
        axios.get(`${API}/active-alarms`)
      ];
      
      const results = await Promise.allSettled(requests);
      
      if (results[0]?.status === 'fulfilled') setPlantHealth(results[0].value.data);
      if (results[1]?.status === 'fulfilled') setActiveAlarms(results[1].value.data);
      
    } catch (e) {
      console.error("Error fetching dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
        <div className="text-sm text-zinc-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-4xl font-light tracking-tight text-zinc-950">Neutral Glass - Instrumentation Dashboard</h1>
        <p className="text-sm text-zinc-700 mt-2">Real-time motor current monitoring and health analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
        {/* Active Alarms Alert */}
        {activeAlarms.length > 0 ? (
          <div className="col-span-1 md:col-span-12">
            <div className="border-2 border-[#E11D48] bg-red-50 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Warning size={28} weight="fill" className="text-[#E11D48]" />
                <div>
                  <h3 className="text-xl font-medium tracking-tight text-[#E11D48]">
                    {activeAlarms.length} Active Alarm{activeAlarms.length > 1 ? 's' : ''} - Immediate Action Required
                  </h3>
                  <p className="text-sm text-red-700 mt-1">Motor current exceeding warning thresholds</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeAlarms.map((alarm, idx) => (
                  <div key={idx} className="bg-white border-2 border-red-300 p-4" data-testid="alarm-card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-base font-medium text-zinc-950">{alarm.plant} - {alarm.machine}</p>
                        <p className="text-sm text-zinc-600 mt-1">{alarm.motor}</p>
                      </div>
                      <span className="px-2 py-1 bg-[#E11D48] text-white text-xs font-bold uppercase">ALARM</span>
                    </div>
                    <div className="mt-3 space-y-1">
                      <p className="text-sm text-zinc-700">
                        <span className="font-bold">Current:</span> 
                        <span className="font-mono text-[#E11D48] font-bold ml-2">{alarm.current}A</span>
                      </p>
                      <p className="text-sm text-zinc-700">
                        <span className="font-bold">Limit:</span> 
                        <span className="font-mono ml-2">{alarm.warning_current}A</span>
                      </p>
                      <p className="text-xs text-zinc-500 mt-2">
                        {new Date(alarm.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="col-span-1 md:col-span-12">
            <div className="border-2 border-[#16A34A] bg-green-50 p-6">
              <div className="flex items-center space-x-3">
                <GearSix size={28} weight="fill" className="text-[#16A34A]" />
                <div>
                  <h3 className="text-xl font-medium tracking-tight text-[#16A34A]">All Systems Normal</h3>
                  <p className="text-sm text-green-700 mt-1">No active alarms - All motor currents within normal range</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Plant Health Status - Full Width */}
        <div className="col-span-1 md:col-span-12">
          <div className="border border-zinc-200 bg-white p-6">
            <h3 className="text-2xl font-light tracking-tight text-zinc-900 mb-6">Plant Health Overview</h3>
            {plantHealth.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {plantHealth.map((plant) => (
                  <div key={plant.plant} className="border-l-4 border-[#002FA7] pl-6 py-4" data-testid={`plant-health-${plant.plant}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-medium text-zinc-950">Plant {plant.plant}</h4>
                      <span className={`text-4xl font-mono font-light ${
                        plant.health_percent >= 90 ? 'text-[#16A34A]' :
                        plant.health_percent >= 70 ? 'text-yellow-700' :
                        'text-[#E11D48]'
                      }`}>
                        {plant.health_percent}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-[#16A34A] rounded-none"></div>
                        <span className="text-zinc-600">OK: <span className="font-mono font-bold">{plant.ok}</span></span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-yellow-500 rounded-none"></div>
                        <span className="text-zinc-600">Warning: <span className="font-mono font-bold">{plant.warning}</span></span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-[#E11D48] rounded-none"></div>
                        <span className="text-zinc-600">Alarm: <span className="font-mono font-bold">{plant.alarm}</span></span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-zinc-300 rounded-none"></div>
                        <span className="text-zinc-600">Total: <span className="font-mono font-bold">{plant.total}</span></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-zinc-500">No monitoring data available. Add readings from Condition Monitoring page.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
