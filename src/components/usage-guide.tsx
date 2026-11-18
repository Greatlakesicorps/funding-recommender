export function UsageGuide({ onClose }: { onClose: () => void }) {
  return (
    <section id="how-to-use" className="guide" aria-labelledby="guide-title">
      <div className="guide-heading">
        <div>
          <span className="guide-eyebrow">WELCOME TO FUNDING EXPLORER</span>
          <h2 id="guide-title">How to use this guide</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close how to use guide"
        >
          ×
        </button>
      </div>
      <ol className="guide-steps">
        <li>
          <strong>Tell us about your team</strong>
          <span>
            Share your state, institution, technology and stage using public or
            fictional details.
          </span>
        </li>
        <li>
          <strong>Explore your options</strong>
          <span>
            Ask a question or choose an example below, then ask follow-ups to
            narrow your search.
          </span>
        </li>
        <li>
          <strong>Check the details</strong>
          <span>
            Review sources searched and confirm eligibility, deadlines and terms
            with the funder.
          </span>
        </li>
      </ol>
      <p>
        Try asking: “We completed Regional I-Corps. What should we explore
        next?”
      </p>
    </section>
  );
}
