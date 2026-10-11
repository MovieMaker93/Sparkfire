import { brandMarkPath } from "../brand";

// Decorative: every place that shows the mark also names Sparkfire in text or an aria-label.
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path fill="currentColor" fillRule="evenodd" d={brandMarkPath} /></svg>;
}

export function BrandWordmark() {
  return <><BrandMark /><span>Sparkfire</span></>;
}
