'use client';
export default function Error({ error, reset }) {
  return (
    <main>
      <div className="wrap">
        <div className="content" id="main-content" tabIndex={-1}>
          <h1>Something went wrong</h1>
          <p className="small">The check did not finish. Your files are safe.</p>
          {error?.message && <p className="error" role="alert">{String(error.message)}</p>}
          <p><button type="button" className="btn" onClick={() => reset?.()}>Try again</button></p>
        </div>
      </div>
    </main>
  );
}
