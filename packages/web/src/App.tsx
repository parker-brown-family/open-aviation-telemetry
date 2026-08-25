import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { Dashboard } from './pages/Dashboard.js';
import { Fleet } from './pages/Fleet.js';
import { Alerts } from './pages/Alerts.js';
import { Architecture } from './pages/Architecture.js';
import { Research } from './pages/Research.js';
import { DemoConsole } from './pages/DemoConsole.js';

/**
 * Routes are flat and few, and aircraft selection is a query parameter rather
 * than a path segment. That keeps every route statically renderable, which is
 * what lets this be published as plain files under a subdirectory of an existing
 * site without a rewrite rule on the web server.
 */
export function App(): React.JSX.Element {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/fleet" element={<Fleet />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/research" element={<Research />} />
        <Route path="/demo" element={<DemoConsole />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
