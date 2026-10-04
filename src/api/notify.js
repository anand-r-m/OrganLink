import { notifications } from '@mantine/notifications';

// Shows a red Mantine notification carrying the server's message (or the error's own message).
export function showApiError(err, title = 'Request failed') {
  notifications.show({
    title,
    message: err?.message || 'Unexpected error',
    color: 'red',
  });
}
