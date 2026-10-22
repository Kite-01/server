import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
};

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: Props) => (
  <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title={title}
    description={description}
  >
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button variant="danger" disabled={pending} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  </Dialog>
);
