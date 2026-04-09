import { useEffect, useState } from "react";
import axios from "axios";
import { GearSix, Files, ChatCircleDots, TrendUp, Warning } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [recentQueries, setRecentQueries] = useState([]);
  const [plantHealth, setPlantHealth] = useState([]);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const requests = [
        axios.get(`${API}/stats`),
        axios.get(`${API}/query/history`)
      ];
      
      try {
        requests.push(axios.get(`${API}/plant-health`));
        requests.push(axios.get(`${API}/active-alarms`));
      } catch (e) {
        console.log("Plant health endpoints not ready yet");
      }
      
      const results = await Promise.allSettled(requests);
      
      if (results[0].status === 'fulfilled') setStats(results[0].value.data);
      if (results[1].status === 'fulfilled') setRecentQueries(results[1].value.data.slice(0, 5));
      if (results[2]?.status === 'fulfilled') setPlantHealth(results[2].value.data);
      if (results[3]?.status === 'fulfilled') setActiveAlarms(results[3].value.data);
      
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
        <h1 className="text-4xl font-light tracking-tight text-zinc-950">System Overview</h1>
        <p className="text-sm text-zinc-700 mt-2">Real-time monitoring and expert system status</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
        {/* Active Alarms Alert */}
        {activeAlarms.length > 0 && (
          <div className="col-span-1 md:col-span-12">
            <div className="border-2 border-[#E11D48] bg-red-50 p-6">
              <div className="flex items-center space-x-3 mb-3">
                <Warning size={24} weight="fill" className="text-[#E11D48]" />
                <h3 className="text-lg font-medium tracking-tight text-[#E11D48]">
                  {activeAlarms.length} Active Alarm{activeAlarms.length > 1 ? 's' : ''} - Action Required
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {activeAlarms.slice(0, 3).map((alarm, idx) => (
                  <div key={idx} className="bg-white border border-red-200 p-3">
                    <p className="text-sm font-medium text-zinc-950">{alarm.plant} - {alarm.machine}</p>
                    <p className="text-xs text-zinc-600 mt-1">{alarm.motor}</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Current: <span className="font-mono font-bold text-[#E11D48]">{alarm.current}A</span> / Limit: {alarm.warning_current}A
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="col-span-1 md:col-span-3">
          <div className="border border-zinc-200 bg-white p-6 h-full">
            <div className="flex items-center space-x-3 mb-4">
              <Files size={20} weight="fill" className="text-[#002FA7]" />
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Documents</p>
            </div>
            <div className="text-4xl sm:text-5xl font-light tracking-tighter font-mono text-zinc-950" data-testid="kpi-documents">
              {stats?.total_documents || 0}
            </div>
            <p className="text-sm text-zinc-600 mt-2">Knowledge base entries</p>
          </div>
        </div>

        <div className="col-span-1 md:col-span-3">
          <div className="border border-zinc-200 bg-white p-6 h-full">
            <div className="flex items-center space-x-3 mb-4">
              <ChatCircleDots size={20} weight="fill" className="text-[#002FA7]" />
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Queries</p>
            </div>
            <div className="text-4xl sm:text-5xl font-light tracking-tighter font-mono text-zinc-950" data-testid="kpi-queries">
              {stats?.total_queries || 0}
            </div>
            <p className="text-sm text-zinc-600 mt-2">Expert consultations</p>
          </div>
        </div>

        <div className="col-span-1 md:col-span-3">
          <div className="border border-zinc-200 bg-white p-6 h-full">
            <div className="flex items-center space-x-3 mb-4">
              <TrendUp size={20} weight="fill" className="text-[#16A34A]" />
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Vector Store</p>
            </div>
            <div className="text-4xl sm:text-5xl font-light tracking-tighter font-mono text-zinc-950" data-testid="kpi-vectors">
              {stats?.vector_store_size || 0}
            </div>
            <p className="text-sm text-zinc-600 mt-2">Indexed chunks</p>
          </div>
        </div>

        <div className="col-span-1 md:col-span-3">
          <div className="border border-zinc-200 bg-white p-6 h-full">
            <div className="flex items-center space-x-3 mb-4">
              <GearSix size={20} weight="fill" className="text-[#002FA7]" />
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">System Status</p>
            </div>
            <div className="text-2xl font-medium tracking-tight text-[#16A34A]" data-testid="system-status">
              OPERATIONAL
            </div>
            <p className="text-sm text-zinc-600 mt-2">All systems online</p>
          </div>
        </div>

        {/* Plant Health Status */}
        {plantHealth.length > 0 && (
          <div className="col-span-1 md:col-span-6">
            <div className="border border-zinc-200 bg-white p-6 h-full">
              <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Plant Health Status</h3>
              <div className="space-y-3">
                {plantHealth.map((plant) => (
                  <div key={plant.plant} className="border-l-2 border-[#002FA7] pl-4 py-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-zinc-950">Plant {plant.plant}</span>
                      <span className={`text-2xl font-mono font-light ${
                        plant.health_percent >= 90 ? 'text-[#16A34A]' :
                        plant.health_percent >= 70 ? 'text-yellow-700' :
                        'text-[#E11D48]'
                      }`}>
                        {plant.health_percent}%
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-xs">
                      <span className="text-[#16A34A]">OK: {plant.ok}</span>
                      <span className="text-yellow-700">Warning: {plant.warning}</span>
                      <span className="text-[#E11D48]">Alarm: {plant.alarm}</span>
                      <span className="text-zinc-500">Total: {plant.total}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Document Type Distribution */}
        <div className={`col-span-1 md:col-span-${plantHealth.length > 0 ? '6' : '12'}`}>
          <div className="border border-zinc-200 bg-white p-6 h-full">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Document Type Distribution</h3>
            <div className="space-y-3">
              {stats?.document_types && Object.keys(stats.document_types).length > 0 ? (
                Object.entries(stats.document_types).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-2 h-2 bg-[#002FA7] rounded-none" />
                      <span className="text-sm text-zinc-700">{type}</span>
                    </div>
                    <span className="font-mono text-sm text-zinc-950">{count}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No documents uploaded yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Recent Queries */}
        <div className="col-span-1 md:col-span-12">
          <div className="border border-zinc-200 bg-white p-6">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Recent Expert Queries</h3>
            <div className="space-y-3">
              {recentQueries.length > 0 ? (
                recentQueries.map((query, idx) => (
                  <div key={idx} className="border-l-2 border-[#002FA7] pl-3 py-1">
                    <p className="text-sm text-zinc-950 line-clamp-1">{query.query}</p>
                    <div className="flex items-center space-x-3 mt-1">
                      {query.machine && (
                        <span className="text-xs text-zinc-500">Machine: {query.machine}</span>
                      )}
                      <span className={`text-xs ${
                        query.confidence === 'High' ? 'text-[#16A34A]' :
                        query.confidence === 'Medium' ? 'text-[#FACC15]' :
                        'text-[#E11D48]'
                      }`}>
                        {query.confidence} Confidence
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No queries yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
