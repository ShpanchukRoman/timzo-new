export default function AuthLayout({ children }) {
  return <div className="auth-layout"><aside className="auth-story"><a className="brand" href="/">timzo</a><div><h2>Графік змін</h2></div></aside><div className="auth-card">{children}</div></div>;
}
