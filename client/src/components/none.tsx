export default function None({ text = "None" }: { text?: string }) {
  return <p className="text-muted text-sm">{text}</p>;
}
