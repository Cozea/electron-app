'use client';

import React from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import {
  Modal,
  ModalContent,
  ModalTitle,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  onUpload: (file: File) => Promise<{ success: boolean } | void>;
  aspect?: number; // default 1 (square)
  maxSizeMB?: number; // default 20
  acceptedTypes?: string[]; // default jpg, jpeg, png, webp
}

export function AvatarUploader({
  children,
  onUpload,
  aspect = 1,
  maxSizeMB = 20,
  acceptedTypes = ['jpeg', 'jpg', 'png', 'webp'],
}: Props) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState<number>(1);
  const [isPending, setIsPending] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [photo, setPhoto] = React.useState<{ url: string; file: File | null }>({
    url: '',
    file: null,
  });
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null);
  const [open, setOpen] = React.useState<boolean>(false);

  const cleanupPhoto = () => {
    if (photo.url) {
      URL.revokeObjectURL(photo.url);
    }
    setPhoto({ url: '', file: null });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenModal = () => {
    if (isPending) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const img_ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
    const validExt = acceptedTypes.map((t) => t.toLowerCase()).includes(img_ext);

    if (!validExt) {
      setError('Selected file is not a supported image type');
      return;
    }

    if (parseFloat(String(file.size)) / (1024 * 1024) >= maxSizeMB) {
      setError(`Selected image is too large (max ${maxSizeMB}MB)`);
      return;
    }

    if (photo.url) {
      URL.revokeObjectURL(photo.url);
    }

    const objectUrl = URL.createObjectURL(file);
    setPhoto({ url: objectUrl, file });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setOpen(true);
  };

  const handleCropComplete = (_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleUpdate = async () => {
    if (!photo?.file || !croppedAreaPixels) {
      setError('No image selected for upload');
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const croppedImg = await getCroppedImg(photo.url, croppedAreaPixels);
      if (!croppedImg || !croppedImg.file) {
        throw new Error('Failed to crop image');
      }

      const file = new File(
        [croppedImg.file],
        photo.file?.name ?? 'cropped.jpeg',
        {
          type: photo.file?.type ?? 'image/jpeg',
        },
      );

      await onUpload(file);
      cleanupPhoto();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update image');
    } finally {
      setIsPending(false);
    }
  };

  const handleClose = () => {
    if (isPending) return;
    cleanupPhoto();
    setOpen(false);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={acceptedTypes.map((t) => `.${t}`).join(',')}
        onChange={handleFileChange}
      />

      {React.isValidElement(children) ? (
        React.cloneElement(children as React.ReactElement<{ onClick?: React.MouseEventHandler }>, {
          onClick: (event: React.MouseEvent) => {
            (children as React.ReactElement<{ onClick?: React.MouseEventHandler }>).props?.onClick?.(event);
            if (!event.defaultPrevented) {
              handleOpenModal();
            }
          },
        })
      ) : (
        <span onClick={handleOpenModal} className="contents cursor-pointer">
          {children}
        </span>
      )}

      <Modal
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleClose();
          }
        }}
      >
        <ModalContent
          showCloseButton={false}
          className="p-0 gap-0 overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl sm:max-w-sm w-full"
        >
          <ModalTitle className="sr-only">Crop avatar</ModalTitle>

          {/* Full-bleed photo & cropper */}
          <div className="relative aspect-square w-full bg-black overflow-hidden select-none">
            {photo?.url ? (
              <Cropper
                image={photo.url}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
                classes={{
                  containerClassName: isPending ? 'opacity-80 pointer-events-none' : '',
                }}
              />
            ) : null}
            <button
              type="button"
              onClick={handleClose}
              className="absolute top-3 right-3 z-20 flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/75 cursor-pointer border border-white/10"
              aria-label="Close"
              title="Close"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
            </button>
          </div>

          {/* Polaroid footer controls */}
          <div className="space-y-4 p-5 bg-card">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-primary h-1.5 cursor-pointer rounded-lg bg-muted"
                disabled={isPending}
              />
            </div>

            {error ? (
              <p className="text-xs text-destructive text-center" role="alert">
                {error}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <Button
                className="w-full cursor-pointer h-9"
                variant="outline"
                type="button"
                disabled={isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                Change image
              </Button>

              <Button
                className="w-full cursor-pointer h-9 font-medium"
                type="button"
                onClick={handleUpdate}
                disabled={isPending || !photo.file}
              >
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

function getRadianAngle(degreeValue: number): number {
  return (degreeValue * Math.PI) / 180;
}

function rotateSize(
  width: number,
  height: number,
  rotation: number,
): { width: number; height: number } {
  const rotRad = getRadianAngle(rotation);

  return {
    width:
      Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height:
      Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

type Flip = {
  horizontal: boolean;
  vertical: boolean;
};

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  rotation = 0,
  flip: Flip = { horizontal: false, vertical: false },
): Promise<{ url: string; file: Blob | null } | null> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to create 2D context');
  }

  const rotRad = getRadianAngle(rotation);

  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.width,
    image.height,
    rotation,
  );

  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(rotRad);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
  ctx.translate(-image.width / 2, -image.height / 2);

  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
  );

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.putImageData(data, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (!file) {
        reject(new Error('Failed to generate cropped image blob'));
        return;
      }
      resolve({
        url: URL.createObjectURL(file),
        file,
      });
    }, 'image/jpeg');
  });
}
