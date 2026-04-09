import { useState } from "react";
import axios from "axios";
import { PaperPlaneRight, Warning, CheckCircle, XCircle } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ExpertQuery = () => {
  const [query, setQuery] = useState("");
  const [machine, setMachine] = useState("");
  const [line, setLine] = useState("");
  const [severity, setSeverity] = useState("");
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await axios.post(`${API}/query`, {
        query,
        machine: machine || null,
        line: line || null,
        severity: severity || null
      });
      setResponse(res.data);
    } catch (err) {
      console.error("Query error:", err);
      setError(err.response?.data?.detail || "Failed to process query");
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceColor = (level) => {
    switch (level) {
      case 'High': return 'text-[#16A34A] border-[#16A34A]';
      case 'Medium': return 'text-yellow-700 border-yellow-400';
      case 'Low': return 'text-[#E11D48] border-[#E11D48]';
      default: return 'text-zinc-500 border-zinc-300';
    }
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-4xl font-light tracking-tight text-zinc-950">Expert Query Interface</h1>
        <p className="text-sm text-zinc-700 mt-2">Submit troubleshooting queries and receive expert analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
        {/* Query Form */}
        <div className="col-span-1 md:col-span-4 lg:col-span-3">
          <div className="border border-zinc-200 bg-white p-6">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Query Details</h3>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Issue Description *
                </label>
                <textarea
                  data-testid="query-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Describe the instrumentation issue..."
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none min-h-[120px]"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Machine / Equipment
                </label>
                <input
                  data-testid="machine-input"
                  type="text"
                  value={machine}
                  onChange={(e) => setMachine(e.target.value)}
                  placeholder="e.g., Furnace-01, Reactor-A2"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Line / Area
                </label>
                <input
                  data-testid="line-input"
                  type="text"
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  placeholder="e.g., Production Line 3"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Severity Level
                </label>
                <select
                  data-testid="severity-select"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                >
                  <option value="">Select severity</option>
                  <option value="Critical">Critical</option>
                  <option value="Major">Major</option>
                  <option value="Minor">Minor</option>
                </select>
              </div>

              <button
                data-testid="submit-query-btn"
                type="submit"
                disabled={loading || !query.trim()}
                className="w-full bg-[#002FA7] text-white hover:bg-[#002FA7]/90 px-4 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <PaperPlaneRight size={16} weight="fill" />
                    <span>Submit Query</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Response Display */}
        <div className="col-span-1 md:col-span-8 lg:col-span-9">
          {error && (
            <div className="border border-red-200 bg-red-50 p-4 mb-4" data-testid="error-message">
              <div className="flex items-center space-x-2">
                <XCircle size={20} weight="fill" className="text-[#E11D48]" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {!response && !error && (
            <div className="border border-zinc-200 bg-white p-8 text-center">
              <p className="text-sm text-zinc-500">Submit a query to receive expert analysis</p>
            </div>
          )}

          {response && (
            <div className="space-y-4" data-testid="rag-response">
              {/* Issue Summary */}
              <div className="bg-zinc-50 border border-[#002FA7]/20 border-l-4 border-l-[#002FA7] p-6">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-medium tracking-tight text-zinc-900">Issue Summary</h3>
                  <span className={`px-3 py-1 text-xs font-bold uppercase tracking-wider border rounded-none ${getConfidenceColor(response.confidence_level)}`}>
                    {response.confidence_level}
                  </span>
                </div>
                <p className="text-sm text-zinc-700 leading-relaxed">{response.issue_summary}</p>
              </div>

              {/* Key Observations */}
              <div className="border border-zinc-200 bg-white p-6">
                <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-3">Key Observations</h3>
                <ul className="space-y-2">
                  {response.key_observations.map((obs, idx) => (
                    <li key={idx} className="flex items-start space-x-2 text-sm text-zinc-700">
                      <span className="text-[#002FA7] mt-1">•</span>
                      <span>{obs}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Retrieved Knowledge */}
              {response.retrieved_knowledge && response.retrieved_knowledge.length > 0 && (
                <div className="border border-zinc-200 bg-white p-6">
                  <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-3">Retrieved Knowledge</h3>
                  <div className="space-y-3">
                    {response.retrieved_knowledge.map((doc, idx) => (
                      <div key={idx} className="border-l-2 border-zinc-300 pl-4 py-2">
                        <div className="flex items-center space-x-3 mb-1">
                          <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#002FA7]">{doc.source}</span>
                          <span className="text-xs text-zinc-500">{doc.document}</span>
                        </div>
                        <p className="text-sm text-zinc-700">{doc.content || doc.key_extract}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Root Cause Analysis */}
              <div className="border border-zinc-200 bg-white p-6">
                <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-3">Root Cause Analysis</h3>
                <div className="space-y-3">
                  {response.root_cause_analysis.map((rca, idx) => (
                    <div key={idx} className="border border-zinc-200 p-4">
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 border border-[#002FA7] flex items-center justify-center flex-shrink-0 mt-1">
                          <span className="text-xs font-mono text-[#002FA7]">{idx + 1}</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-zinc-950 mb-1">{rca.cause}</p>
                          <p className="text-sm text-zinc-600">{rca.justification}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Actions */}
              <div className="border border-zinc-200 bg-white p-6">
                <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Recommended Actions</h3>
                
                <div className="space-y-4">
                  {response.recommended_actions.immediate && (
                    <div>
                      <div className="flex items-center space-x-2 mb-2">
                        <Warning size={16} weight="fill" className="text-[#E11D48]" />
                        <h4 className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-[#E11D48]">Immediate</h4>
                      </div>
                      <ul className="space-y-1 pl-6">
                        {response.recommended_actions.immediate.map((action, idx) => (
                          <li key={idx} className="text-sm text-zinc-700 list-disc">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {response.recommended_actions.detailed_troubleshooting && (
                    <div>
                      <div className="flex items-center space-x-2 mb-2">
                        <CheckCircle size={16} weight="fill" className="text-[#002FA7]" />
                        <h4 className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-[#002FA7]">Detailed Troubleshooting</h4>
                      </div>
                      <ul className="space-y-1 pl-6">
                        {response.recommended_actions.detailed_troubleshooting.map((action, idx) => (
                          <li key={idx} className="text-sm text-zinc-700 list-disc">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {response.recommended_actions.preventive && (
                    <div>
                      <div className="flex items-center space-x-2 mb-2">
                        <CheckCircle size={16} weight="fill" className="text-[#16A34A]" />
                        <h4 className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-[#16A34A]">Preventive</h4>
                      </div>
                      <ul className="space-y-1 pl-6">
                        {response.recommended_actions.preventive.map((action, idx) => (
                          <li key={idx} className="text-sm text-zinc-700 list-disc">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Drawing Reference & Condition Monitoring */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-zinc-200 bg-white p-6">
                  <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-3">Drawing Reference</h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Type:</span>
                      <p className="text-sm text-zinc-950 mt-1">{response.drawing_reference.drawing_type}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Verify:</span>
                      <p className="text-sm text-zinc-950 mt-1">{response.drawing_reference.what_to_verify}</p>
                    </div>
                  </div>
                </div>

                <div className="border border-zinc-200 bg-white p-6">
                  <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-3">Condition Monitoring</h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Parameters:</span>
                      <p className="text-sm text-zinc-950 mt-1">
                        {Array.isArray(response.condition_monitoring.parameters_to_verify)
                          ? response.condition_monitoring.parameters_to_verify.join(', ')
                          : response.condition_monitoring.parameters_to_verify}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Trend:</span>
                      <p className="text-sm text-zinc-950 mt-1">{response.condition_monitoring.trend_to_observe}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Final Recommendation */}
              <div className="border-2 border-[#002FA7] bg-white p-6">
                <h3 className="text-lg font-medium tracking-tight text-[#002FA7] mb-2">Final Recommendation</h3>
                <p className="text-sm text-zinc-700 leading-relaxed">{response.final_recommendation}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExpertQuery;