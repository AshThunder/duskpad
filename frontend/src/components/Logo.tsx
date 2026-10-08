export function Logo({ size = 32 }: { size?: number }) {
  return <img src="/duskpad.svg" width={size} height={size} alt="" className="rounded-[10px]" />;
}
