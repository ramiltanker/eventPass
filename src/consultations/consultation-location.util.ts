import { BadRequestException } from '@nestjs/common';

const ONLINE_PREFIX = 'online::';
const OFFLINE_PREFIX = 'offline::';

export type ConsultationLocation = {
  isOnline: boolean;
  meetingLink: string | null;
  audienceNumber: string | null;
};

export const parseConsultationLocation = (
  value: string | null | undefined,
): ConsultationLocation => {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue.startsWith(ONLINE_PREFIX)) {
    const meetingLink = normalizedValue.slice(ONLINE_PREFIX.length).trim();

    return {
      isOnline: true,
      meetingLink: meetingLink || null,
      audienceNumber: null,
    };
  }

  if (normalizedValue.startsWith(OFFLINE_PREFIX)) {
    const audienceNumber = normalizedValue.slice(OFFLINE_PREFIX.length).trim();

    return {
      isOnline: false,
      meetingLink: null,
      audienceNumber: audienceNumber || null,
    };
  }

  return {
    isOnline: true,
    meetingLink: normalizedValue || null,
    audienceNumber: null,
  };
};

export const buildStoredConsultationLocation = (params: {
  isOnline: boolean;
  meetingLink?: string | null;
  audienceNumber?: string | null;
}) => {
  if (params.isOnline) {
    const meetingLink = String(params.meetingLink ?? '').trim();

    if (!meetingLink) {
      throw new BadRequestException(
        'meetingLink is required for online consultation',
      );
    }

    return `${ONLINE_PREFIX}${meetingLink}`;
  }

  const audienceNumber = String(params.audienceNumber ?? '').trim();

  if (!audienceNumber) {
    throw new BadRequestException(
      'audienceNumber is required for offline consultation',
    );
  }

  return `${OFFLINE_PREFIX}${audienceNumber}`;
};
