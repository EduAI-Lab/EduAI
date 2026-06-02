import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge } from '~/components/ui/badge';
import { Upload, FileText, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '~/components/ui/alert';

export interface CourseMaterial {
  id: string;
  title: string;
  mimeType: string;
  fileSize: number;
  status: 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  chunks?: Array<{ id: string; content: string }>;
}

export interface CourseMaterialsUploadProps {
  materials: CourseMaterial[];
  isUploading?: boolean;
  error?: string | null;
  success?: string | null;
  onFileSelect: (file: File) => void;
}

export function CourseMaterialsUpload({
  materials,
  isUploading = false,
  error = null,
  success = null,
  onFileSelect,
}: CourseMaterialsUploadProps) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'READY':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return <Badge variant="secondary">Processing</Badge>;
      case 'READY':
        return <Badge variant="default">Ready</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Course Materials
          </CardTitle>
          <CardDescription>
            Upload documents to make them available for AI chat. Supported formats: PDF, DOCX, PPTX, TXT, MD
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="file-upload">Select File</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown"
                onChange={handleFileChange}
                disabled={isUploading}
                className="mt-2"
              />
            </div>

            {isUploading && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Uploading and processing material...</AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Course Materials</CardTitle>
          <CardDescription>
            Materials uploaded to this course ({materials.length} total)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {materials.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No materials uploaded yet. Upload a file to get started.
              </p>
            ) : (
              materials.map((material) => (
                <div
                  key={material.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(material.status)}
                    <div>
                      <h4 className="font-medium">{material.title}</h4>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(material.fileSize)} • {material.chunks?.length || 0} chunks
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(material.status)}
                    <span className="text-xs text-muted-foreground">
                      {new Date(material.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
