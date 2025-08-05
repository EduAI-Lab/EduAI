import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge } from '~/components/ui/badge';
import { Upload, FileText, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '~/components/ui/alert';

interface CourseMaterial {
  id: string;
  title: string;
  mimeType: string;
  fileSize: number;
  status: 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  chunks?: Array<{ id: string; content: string }>;
}

interface CourseMaterialsUploadProps {
  courseId: string;
  apiKeys: any;
}

export function CourseMaterialsUpload({ courseId, apiKeys }: CourseMaterialsUploadProps) {
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('apiKeys', JSON.stringify(apiKeys));

      const response = await fetch(`/api/courses/${courseId}/materials`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload material');
      }

      setSuccess('Material uploaded successfully!');
      // Refresh materials list
      loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const loadMaterials = async () => {
    try {
      const response = await fetch(`/api/courses/${courseId}/materials`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load materials');
      }

      setMaterials(result.materials || []);
    } catch (err) {
      console.error('Failed to load materials:', err);
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

  // Load materials on component mount
  useEffect(() => {
    loadMaterials();
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Course Materials
          </CardTitle>
          <CardDescription>
            Upload documents to make them available for AI chat. Supported formats: TXT, MD
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="file-upload">Select File</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={handleFileUpload}
                disabled={uploading}
                className="mt-2"
              />
            </div>

            {uploading && (
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