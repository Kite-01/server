import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState } from "react";
import { Skeleton } from "./ui/skeleton";

interface SmartImageProps extends React.ComponentProps<"img"> {
  url?: string | null;
  loader?: React.ReactNode;
  fallbackComponent?: (props: { className: string }) => React.ReactNode;
}

const BROKEN_IMAGE = "/broken-img.png";

export default function SmartImage({
  url,
  className,
  loader,
  src = url ?? undefined,
  fallbackComponent: FallbackComponent,
  ...props
}: SmartImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [status, setStatus] = useState<"loading" | "loaded">("loading");

  useEffect(() => {
    setCurrentSrc(src);
    setStatus("loading");
  }, [src]);

  const handleLoad = () => {
    setStatus("loaded");
  };

  const handleError = () => {
    if (currentSrc !== BROKEN_IMAGE) {
      setCurrentSrc(BROKEN_IMAGE);
      setStatus("loading");
      return;
    }

    setStatus("loaded");
  };

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;

    if (img.naturalWidth > 0) handleLoad();
    else handleError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSrc]);

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center">
      {status === "loading" ? (
        <>
          {loader ?? (
            <Skeleton className={cn("size-9 rounded-full", className)} />
          )}
        </>
      ) : null}

      {currentSrc == BROKEN_IMAGE && !!FallbackComponent ? (
        <FallbackComponent
          className={cn(
            "size-9 flex items-center justify-center rounded-full object-contain bg-white",
            className,
          )}
        />
      ) : null}

      <img
        ref={imgRef}
        className={cn(
          "size-9 rounded-full object-contain border border-line",
          status === "loading" ||
            (currentSrc == BROKEN_IMAGE && !!FallbackComponent)
            ? "hidden"
            : "",
          className,
        )}
        src={currentSrc}
        onLoad={handleLoad}
        onError={handleError}
        {...props}
      />
    </div>
  );
}
