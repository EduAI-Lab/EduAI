import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@eduai/ui";

import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";

interface ScrollRevealProps {
  index?: number;
  children: ReactNode;
  className?: string;
  /** Disable parallax drift; keep fade-in only */
  parallax?: boolean;
}

/**
 * Staggered scroll reveal + optional parallax — Apple-style section entrance.
 * Respects account-level reduced-motion preference.
 */
export function ScrollReveal({
  index = 0,
  children,
  className,
  parallax = true,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const motionReduced = useMotionReducedPreference();
  const [revealed, setRevealed] = useState(motionReduced);
  const [parallaxY, setParallaxY] = useState(0);

  useEffect(() => {
    if (motionReduced) return;
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setRevealed(true);
      },
      { threshold: 0.1, rootMargin: "0px 0px -4% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [motionReduced]);

  useEffect(() => {
    if (motionReduced || !parallax) return;
    const element = ref.current;
    if (!element) return;

    const updateParallax = () => {
      const rect = element.getBoundingClientRect();
      const viewportMid = window.innerHeight * 0.5;
      const elementMid = rect.top + rect.height * 0.5;
      const progress = (elementMid - viewportMid) / window.innerHeight;
      const depth = 6 + (index % 3) * 4;
      setParallaxY(progress * depth);
    };

    updateParallax();
    window.addEventListener("scroll", updateParallax, { passive: true });
    window.addEventListener("resize", updateParallax, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateParallax);
      window.removeEventListener("resize", updateParallax);
    };
  }, [index, motionReduced, parallax]);

  if (motionReduced) {
    return <div className={className}>{children}</div>;
  }

  const enterOffset = revealed ? 0 : 22;
  const delayMs = Math.min(index, 10) * 55;

  return (
    <div
      ref={ref}
      className={cn("will-change-transform", className)}
      style={{
        opacity: revealed ? 1 : 0,
        transform: `translateY(${parallaxY + enterOffset}px)`,
        transition: `opacity 600ms ease-out ${delayMs}ms, transform 600ms ease-out ${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}
