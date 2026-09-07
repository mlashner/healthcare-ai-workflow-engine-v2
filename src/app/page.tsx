import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>CarePilot</h1>
      <p>
        Demonstration care-coordination platform. Fictional data only. Not a medical product
        and not for clinical use.
      </p>

      <section className="review-section" aria-labelledby="architecture-heading">
        <h2 id="architecture-heading">Architecture</h2>
        <p className="section-hint">Intelligence proposes. Authority decides.</p>
        <p className="architecture-flow" data-testid="architecture-flow">
          Agent → Tools → Policy → Human → Action
        </p>
      </section>

      <p>
        <Link href="/reviews">Clinician review dashboard</Link>
        {" — interview demo: act as Jordan Blake, then open the run tagged "}
        <strong>interview demo</strong>.
      </p>
      <p>
        <Link href="/admin">AI observability</Link>
        {" — eval score over time after "}
        <code>npm run eval</code>.
      </p>
      <p>
        <a href="/api/health">Health check</a>
      </p>
    </main>
  );
}
