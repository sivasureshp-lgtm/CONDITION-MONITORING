import { useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import ExpertQuery from "@/pages/ExpertQuery";
import KnowledgeBase from "@/pages/KnowledgeBase";
import ConditionMonitoring from "@/pages/ConditionMonitoring";
import Dashboard from "@/pages/Dashboard";
import { GearSix, Files, ChartLine, ChatCircleDots } from "@phosphor-icons/react";

const Navigation = () => {
  const location = useLocation();
  
  const navItems = [
    { path: "/", label: "Dashboard", icon: GearSix },
    { path: "/expert", label: "Expert Query", icon: ChatCircleDots },
    { path: "/knowledge", label: "Knowledge Base", icon: Files },
    { path: "/monitoring", label: "Condition Monitoring", icon: ChartLine },
  ];
  
  return (
    <nav className="border-b border-zinc-200 bg-white">
      <div className="w-full max-w-[1920px] mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-2">
            <GearSix size={32} weight="fill" className="text-[#002FA7]" />
            <div>
              <h1 className="text-xl font-light tracking-tight text-zinc-950">Process Control Expert</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Instrumentation & Diagnostics</p>
            </div>
          </div>
          
          <div className="flex space-x-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, '-')}`}
                  className={`px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none border-b-2 ${
                    isActive
                      ? 'border-[#002FA7] text-zinc-950'
                      : 'border-transparent text-zinc-600 hover:text-zinc-950 hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Icon size={16} weight={isActive ? "fill" : "regular"} />
                    <span>{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
};

function App() {
  return (
    <div className="App bg-zinc-50 min-h-screen">
      <BrowserRouter>
        <Navigation />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/expert" element={<ExpertQuery />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/monitoring" element={<ConditionMonitoring />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;