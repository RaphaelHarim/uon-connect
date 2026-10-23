import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui';
import { PwaPrompt } from './features/PwaPrompt';
import { useAuth } from './lib/auth';
import { RealtimeProvider } from './lib/realtime';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';

const DashboardPage = lazy(() => import('./pages/Dashboard'));
const TicketsPage = lazy(() => import('./pages/Tickets'));
const TicketNewPage = lazy(() => import('./pages/TicketNew'));
const TicketDetailPage = lazy(() => import('./pages/TicketDetail'));
const ChatPage = lazy(() => import('./pages/Chat'));
const MeetingsPage = lazy(() => import('./pages/Meetings'));
const CallPage = lazy(() => import('./pages/Call'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const PeoplePage = lazy(() => import('./pages/People'));
const PersonPage = lazy(() => import('./pages/Person'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const OrgPage = lazy(() => import('./pages/Org'));
const AdminHome = lazy(() => import('./pages/admin/AdminHome'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminUserDetail = lazy(() => import('./pages/admin/AdminUserDetail'));
const AdminOrg = lazy(() => import('./pages/admin/AdminOrg'));
const AdminTicketConfig = lazy(() => import('./pages/admin/AdminTicketConfig'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminIntegrations = lazy(() => import('./pages/admin/AdminIntegrations'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Carregando UON CONNECT…" className="h-full" />;
  if (!me) return <Navigate to={`/login?voltar=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <RealtimeProvider>{children}</RealtimeProvider>;
}

const page = (node: ReactNode) => <Suspense fallback={<Spinner />}>{node}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: 'chamados', element: page(<TicketsPage />) },
      { path: 'chamados/novo', element: page(<TicketNewPage />) },
      { path: 'chamados/:id', element: page(<TicketDetailPage />) },
      { path: 'conversas', element: page(<ChatPage />) },
      { path: 'conversas/:id', element: page(<ChatPage />) },
      { path: 'reunioes', element: page(<MeetingsPage />) },
      { path: 'reunioes/:id', element: page(<CallPage />) },
      { path: 'notificacoes', element: page(<NotificationsPage />) },
      { path: 'pessoas', element: page(<PeoplePage />) },
      { path: 'pessoas/:id', element: page(<PersonPage />) },
      { path: 'perfil', element: page(<ProfilePage />) },
      { path: 'organizacao', element: page(<OrgPage />) },
      { path: 'admin', element: page(<AdminHome />) },
      { path: 'admin/usuarios', element: page(<AdminUsers />) },
      { path: 'admin/usuarios/:id', element: page(<AdminUserDetail />) },
      { path: 'admin/organizacao', element: page(<AdminOrg />) },
      { path: 'admin/chamados', element: page(<AdminTicketConfig />) },
      { path: 'admin/auditoria', element: page(<AdminAudit />) },
      { path: 'admin/integracoes', element: page(<AdminIntegrations />) },
      { path: 'admin/configuracoes', element: page(<AdminSettings />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <PwaPrompt />
    </>
  );
}
