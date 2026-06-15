export default function PageFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100vh',
        background: '#0a0e1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <style>{`@keyframes bt-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        aria-hidden="true"
        style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(0,200,150,0.25)',
          borderTopColor: '#00c896',
          borderRadius: '50%',
          animation: 'bt-spin 1s linear infinite',
        }}
      />
      <p style={{ color: '#8b90a8', fontSize: '14px', margin: 0 }}>Loading BillTap...</p>
    </div>
  );
}