export default function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <div className="auth-card">{children}</div>
    </div>
  );
}
