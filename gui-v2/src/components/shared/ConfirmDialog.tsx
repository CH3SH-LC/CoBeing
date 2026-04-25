import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "default";
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  onConfirm,
  variant = "default",
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 400, padding: "24px 28px" }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription style={{ marginTop: 8 }}>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-3" style={{ marginTop: 8 }}>
          <button
            onClick={() => onOpenChange(false)}
            className="h-8 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            className={`h-8 px-4 rounded-lg text-sm font-medium text-white transition-colors ${
              variant === "danger"
                ? "bg-danger hover:bg-danger/90"
                : "bg-accent hover:bg-accent/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
