import { createHash } from 'crypto';

export interface FileInfo {
  title: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  content: string;
}

/**
 * Generate SHA256 checksum for content
 */
export function generateChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Extract text from different file types
 */
export async function extractTextFromFile(
  file: File | any,
  content: string
): Promise<FileInfo> {
  const title = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
  const mimeType = file.type;
  const fileSize = file.size;
  const checksum = generateChecksum(content);

  return {
    title,
    mimeType,
    fileSize,
    checksum,
    content,
  };
}

/**
 * Validate file type and size
 */
export function validateFile(file: File | any): { isValid: boolean; error?: string } {
  const allowedTypes = [
    'text/plain',
    'text/markdown',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `File type ${file.type} is not supported. Supported types: PDF, TXT, MD, DOCX`,
    };
  }

  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File size ${file.size} bytes exceeds maximum allowed size of ${maxSize} bytes`,
    };
  }

  return { isValid: true };
}

/**
 * Read file content as text
 */
export async function readFileAsText(file: File | any): Promise<string> {
  // Handle server-side file objects (from formData)
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  // Handle browser File objects
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Failed to read file as text'));
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsText(file);
    });
  }

  throw new Error('File reading not supported in this environment');
}

/**
 * Process uploaded file and extract text content
 */
export async function processUploadedFile(file: File | any): Promise<FileInfo> {
  // Validate file
  const validation = validateFile(file);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  // Read file content
  let content: string;

  if (file.type === 'text/plain' || file.type === 'text/markdown') {
    content = await readFileAsText(file);
  } else {
    // For PDF and DOCX, we'll need to implement proper parsing
    // For now, throw an error indicating these need special handling
    throw new Error(`File type ${file.type} requires special parsing. PDF and DOCX support coming soon.`);
  }

  // Extract file info
  return extractTextFromFile(file, content);
}