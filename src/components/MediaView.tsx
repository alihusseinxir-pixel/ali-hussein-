"use client";
/* eslint-disable @next/next/no-img-element */
export function MediaView({ id, type, name }: { id: string; type: string; name: string }) {
  const src = `/api/files/${id}`;
  if (type.startsWith("image/")) return <img src={src} alt={name} className="max-h-72 rounded" />;
  if (type.startsWith("video/")) return <video src={src} controls preload="metadata" className="max-h-72 rounded" />;
  if (type === "application/pdf") return <iframe src={src} title={name} className="h-72 w-80 rounded border" />;
  return <a className="text-brand-600 underline" href={`${src}?download=1`}>{name}</a>;
}
