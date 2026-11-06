import Image from "next/image";

/**
 * The logo for the current theme, never on a white plate: in the light theme the normal logo, in the dark theme the same logo with
 * light lettering (the red and the oil yellow stay). `onDark` is for places that are always dark (the sign-in scene).
 * Paper documents keep using the normal logo file on their own white paper.
 */
export default function BrandLogo({ className = "", alt = "Super Drive Oil", priority = false, onDark = false }: { className?: string; alt?: string; priority?: boolean; onDark?: boolean }) {
  if (onDark) return <Image src="/brand/logo-full-dark.png" alt={alt} width={900} height={456} className={`block w-auto ${className}`} priority={priority} />;
  return (
    <>
      <Image src="/brand/logo-full.png" alt={alt} width={900} height={456} className={`logo-light block w-auto ${className}`} priority={priority} />
      <Image src="/brand/logo-full-dark.png" alt={alt} width={900} height={456} className={`logo-dark w-auto ${className}`} priority={priority} aria-hidden />
    </>
  );
}
