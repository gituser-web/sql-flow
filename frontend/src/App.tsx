import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import DataSourcesPage from './pages/datasources/DataSourcesPage'
import WorkflowListPage from './pages/workflows/WorkflowListPage'
import WorkflowDetailPage from './pages/workflows/WorkflowDetailPage'
import WorkflowEditorPage from './pages/workflows/WorkflowEditorPage'
import ApiListPage from './pages/apis/ApiListPage'
import ApiDetailPage from './pages/apis/ApiDetailPage'
import ApiEditPage from './pages/apis/ApiEditPage'
import ApiTokensPage from './pages/apis/ApiTokensPage'

/** 应用外壳：左侧导航 + 内容区。路由在此集中定义。 */
export default function App() {
  return (
    <div className="app">
      <aside className="nav">
        <div className="nav-brand">sql-flow</div>
        <nav className="nav-links">
          <NavLink to="/apis" className={({ isActive }) => 'nav-link' + (isActive ? ' nav-link--on' : '')}>
            API
          </NavLink>
          <NavLink to="/workflows" className={({ isActive }) => 'nav-link' + (isActive ? ' nav-link--on' : '')}>
            SQL 流
          </NavLink>
          <NavLink to="/api-tokens" className={({ isActive }) => 'nav-link' + (isActive ? ' nav-link--on' : '')}>
            API 凭证
          </NavLink>
          <NavLink to="/datasources" className={({ isActive }) => 'nav-link' + (isActive ? ' nav-link--on' : '')}>
            数据源
          </NavLink>
        </nav>
        <div className="nav-foot">把只读 SQL 编排成一个 API</div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/workflows" replace />} />
          <Route path="/datasources" element={<DataSourcesPage />} />
          <Route path="/apis" element={<ApiListPage />} />
          <Route path="/apis/:id" element={<ApiDetailPage />} />
          <Route path="/apis/:id/edit" element={<ApiEditPage />} />
          <Route path="/api-tokens" element={<ApiTokensPage />} />
          <Route path="/workflows" element={<WorkflowListPage />} />
          <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
          <Route path="/workflows/:id/edit" element={<WorkflowEditorPage />} />
          <Route path="*" element={<Navigate to="/workflows" replace />} />
        </Routes>
      </main>
    </div>
  )
}
