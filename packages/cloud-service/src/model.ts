export type UserRecord = {
  userId: string;
  createdAt: number;
  lastActiveAt: number;
  status: 'active' | 'disabled' | 'deleted';
};

export type CreditAccount = {
  userId: string;
  period: string;
  bucketId: string;
  available: number;
  reserved: number;
  monthlyGrant: number;
  periodEndsAt: number;
};

export type CreditBucket = {
  userId: string;
  period: string;
  granted: number;
  available: number;
  reserved: number;
  consumed: number;
  expired: number;
  createdAt: number;
  endsAt: number;
};

export type CreditReservation = {
  reservationId: string;
  userId: string;
  bucketId: string;
  state: 'pending' | 'consumed' | 'released';
  createdAt: number;
  settledAt: number | null;
};

export type CreditLedgerEntry = {
  userId: string;
  bucketId: string;
  operation: 'GRANT' | 'EXPIRE' | 'RESERVE' | 'CONSUME' | 'RELEASE';
  reservationId: string | null;
  deltaAvailable: number;
  deltaReserved: number;
  deltaConsumed: number;
  deltaExpired: number;
  createdAt: number;
};
