import { Button, Modal } from '@mantine/core';

/* Mantine Modal wrapper — ui_mastercontext.md Section 4.4.
   Overlay rgba(0,0,0,0.3) + 4px blur, neumorphic body, 32px padding,
   .neu-inset inputs (see .form-modal__body rules in index.css), and the
   Section 9 open animation (fade + scale 0.95 -> 1.0 over 200ms). */

const MODAL_TRANSITION = {
  in: { opacity: 1, transform: 'scale(1)' },
  out: { opacity: 0, transform: 'scale(0.95)' },
  common: { transformOrigin: 'center' },
  transitionProperty: 'opacity, transform',
};

export default function FormModal({
  opened,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  loading = false,
  size = 'md',
  ...modalProps
}) {
  function handleSubmit(event) {
    event.preventDefault();
    onSubmit?.(event);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={size}
      centered
      radius="lg"
      padding={0}
      overlayProps={{ color: '#000', backgroundOpacity: 0.3, blur: 4 }}
      transitionProps={{ transition: MODAL_TRANSITION, duration: 200 }}
      classNames={{
        content: 'form-modal__content',
        header: 'form-modal__header',
        body: 'form-modal__body',
      }}
      {...modalProps}
    >
      <form onSubmit={handleSubmit}>
        {children}

        <div className="form-modal__actions">
          <Button
            type="button"
            variant="subtle"
            color="gray"
            onClick={onClose}
            aria-label={cancelLabel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            className="neu-raised-sm neu-button"
            loading={loading}
            aria-label={submitLabel}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
