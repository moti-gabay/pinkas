export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center p-6 ${className}`} role="status" aria-label="טוען">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
    </div>
  );
}
