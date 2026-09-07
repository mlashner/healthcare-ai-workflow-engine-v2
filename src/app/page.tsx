import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>CarePilot</h1>
      <p>
        Demonstration care-coordination platform. Fictional data only. Not a medical product
        and not for clinical use.
      </p>
      <p>
        <Link href="/reviews">Clinician review dashboard</Link>
      </p>
      <p>
        <a href="/api/health">Health check</a>
      </p>
    </main>
  );
}
