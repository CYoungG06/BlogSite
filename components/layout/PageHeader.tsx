export default function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">
        {title}
      </h1>
      {description ? (
        <p className="mt-3 max-w-2xl text-muted">{description}</p>
      ) : null}
    </header>
  );
}
