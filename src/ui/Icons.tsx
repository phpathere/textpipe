import type { JSX } from "preact";

interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "children"> {
  size?: number;
}

interface BrandMarkProps {
  size?: number;
}

function IconBase({ size = 20, ...props }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function BrandMark({ size = 28 }: BrandMarkProps): JSX.Element {
  return (
    <img
      class="brand-mark__image"
      src="icons/icon-128.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="sync"
      draggable={false}
    />
  );
}

export function SettingsIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3v-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.51V3h4v.09A1.7 1.7 0 0 0 15.1 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.54.56.95 1.1 1.09h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
    </IconBase>
  );
}

export function CopyIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </IconBase>
  );
}

export function LockIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="m5 12 4 4L19 6" />
    </IconBase>
  );
}

export function AlertIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.75 3h15.3a2 2 0 0 0 1.75-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </IconBase>
  );
}
