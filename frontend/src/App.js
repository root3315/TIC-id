import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import SearchPage from "@/pages/SearchPage";
import ResultsPage from "@/pages/ResultsPage";
import CatalogPage from "@/pages/CatalogPage";
import AIDetectorPage from "@/pages/AIDetectorPage";
import SystemPage from "@/pages/SystemPage";
import Starfield from "@/components/Starfield";
import NavBar from "@/components/NavBar";
import { Toaster } from "@/components/ui/sonner";
import { LangProvider } from "@/lib/i18n";

// На странице системы фон спокойный: там речь о настоящей звезде, выдуманное небо мешает
const Backdrop = () => <Starfield calm={useLocation().pathname === "/system"} />;

function App() {
  return (
    <LangProvider>
      <div className="App">
        <BrowserRouter>
          <Backdrop />
          <NavBar />
          <div className="relative" style={{ zIndex: 1 }}>
            <Routes>
              <Route path="/" element={<SearchPage />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/ai-detector" element={<AIDetectorPage />} />
              <Route path="/system" element={<SystemPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </div>
    </LangProvider>
  );
}

export default App;
