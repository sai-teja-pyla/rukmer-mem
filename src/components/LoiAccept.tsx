import { LOI_TITLE } from '../legal/loi';

/**
 * Affirmative clickwrap. The account cannot be created until this box is checked.
 * The letter opens in a new tab so the signup form stays in place.
 */
export default function LoiAccept({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-[13px] leading-6 text-black cursor-pointer">
      <input
        type="checkbox"
        name="loi"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-black"
      />
      <span>
        By creating an account, I agree to the{' '}
        <a
          href="/loi"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-black underline underline-offset-4"
          onClick={(e) => e.stopPropagation()}
        >
          {LOI_TITLE}
        </a>
        , the{' '}
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4" onClick={(e) => e.stopPropagation()}>
          Terms
        </a>
        , and the{' '}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4" onClick={(e) => e.stopPropagation()}>
          Privacy Policy
        </a>
        {' '}on behalf of myself and my organization.
      </span>
    </label>
  );
}
