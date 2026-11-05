"use client";

import { useActionState, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

type Props = {
  productId: string;
  productName: string;
  /** version number of the stored picture (changes when replaced), null = no picture yet */
  version: number | null;
  canEdit: boolean;
  upload: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  remove: (fd: FormData) => Promise<void>;
};

const initial: ActionState = {};

export default function ProductImageCard({ productId, productName, version, canEdit, upload, remove }: Props) {
  const [state, action] = useActionState(upload, initial);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const src = preview ?? (version ? `/api/product-image/${productId}?size=full&v=${version}` : null);

  return (
    <section className="card card-pad mb-5">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Product picture</h2>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-gradient-to-b from-white to-slate-100">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={productName} className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs text-slate-400">
              <ImagePlus size={28} />
              No picture yet
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-600">This picture appears on the POS product cards and in stock lists. A clear photo on a plain background works best.</p>
          {canEdit && (
            <form action={action} className="mt-3 space-y-3">
              <input type="hidden" name="productId" value={productId} />
              <input
                ref={input}
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-navy-700 hover:file:bg-navy-100"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
              />
              {state.error && <Alert>{state.error}</Alert>}
              {state.ok && <Alert kind="success">{state.message}</Alert>}
              <div className="flex flex-wrap gap-2">
                <SubmitButton pendingLabel="Uploading…">{version ? "Replace picture" : "Upload picture"}</SubmitButton>
              </div>
            </form>
          )}
          {canEdit && version && (
            <form action={remove} className="mt-2">
              <input type="hidden" name="productId" value={productId} />
              <button type="submit" className="text-sm font-medium text-brand-red-dark hover:underline">
                Remove picture
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
