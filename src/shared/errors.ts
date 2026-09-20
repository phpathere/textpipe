export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class StorageDataError extends AppError {
  constructor(message = "Dữ liệu đồng bộ không hợp lệ.") {
    super(message, "INVALID_STORAGE_DATA");
  }
}

export class ConflictError extends AppError {
  constructor() {
    super("Có bản mới hơn từ một máy khác.", "SYNC_CONFLICT");
  }
}

export class NoteTooLargeError extends AppError {
  constructor(message = "Nội dung vượt quá giới hạn cho phép.") {
    super(message, "NOTE_TOO_LARGE");
  }
}

export class LockedError extends AppError {
  constructor() {
    super("Cần mở khóa để đọc hoặc ghi nội dung.", "LOCKED");
  }
}

export class SyncQuotaError extends AppError {
  constructor() {
    super(
      "Bộ nhớ Chrome Sync gần đầy. Hãy xóa dữ liệu cũ hoặc dùng khôi phục trong Cài đặt.",
      "SYNC_QUOTA",
    );
  }
}

export class InvalidPassphraseError extends AppError {
  constructor() {
    super("Passphrase không đúng.", "INVALID_PASSPHRASE");
  }
}

export class PassphrasePolicyError extends AppError {
  constructor(message: string) {
    super(message, "PASSPHRASE_POLICY");
  }
}
