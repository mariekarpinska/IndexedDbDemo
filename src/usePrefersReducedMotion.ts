import { useEffect, useState } from "react";

// usePrefersReducedMotion reports whether the user asked the os to reduce motion,
// we honor it everywhere we animate, the print-in and the inspector pulse both
// check this so the one bold moment never fires for people who opted out
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
