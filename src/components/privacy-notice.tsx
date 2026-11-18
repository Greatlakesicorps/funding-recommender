import { HISTORY_RETENTION_DAYS } from "@/lib/search-history";

export function PrivacyNotice() {
  return (
    <details className="privacy-notice">
      <summary id="privacy-summary">
        Use non-confidential team details only. How your information is used
      </summary>
      <div>
        <p>
          Your question and a limited portion of earlier messages are sent to
          U-M Maizey to generate an answer. Maizey logs the full request,
          including that conversation context. Do not include personal,
          sensitive, proprietary, or unpublished research information.
        </p>
        <p>
          Your searches are saved only in this browser&apos;s local storage so
          you can reopen them under Past searches (History on small screens).
          Each one is deleted automatically {HISTORY_RETENTION_DAYS} days after
          you last use it, or sooner if you delete it or clear this site&apos;s
          data. Anyone using this browser profile can see them, so use Clear all
          on shared computers. Deleting here does not delete Maizey&apos;s
          records. A necessary, signed cookie groups the current conversation
          and expires in your browser after 24 hours.
        </p>
        <p>
          To limit abuse, Cloudflare uses a keyed hash of your IP address with a
          request counter, not your raw IP address in that counter. Cleanup is
          scheduled after the 10-minute limit window; hosting logs and backups
          may have different retention. People sharing a network share the limit
          of 12 requests per 10 minutes.
        </p>
        <p>
          This is a prototype. Maizey and hosting retention, access, and
          deletion arrangements still need ITS confirmation before public
          launch. For now, use fictional or public information only.
        </p>
      </div>
    </details>
  );
}
