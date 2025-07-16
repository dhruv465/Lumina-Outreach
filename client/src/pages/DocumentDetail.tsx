import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Spinner } from '../components/ui/spinner';
import { ArrowLeft, FileText, Edit, Download, Tag, Trash2 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import knowledgeApi from '../services/knowledgeApi';

interface Document {
  _id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: 'processed' | 'processing' | 'error' | 'pending';
  chunkCount?: number;
  categoryId?: {
    _id: string;
    name: string;
  };
  tags?: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  processingError?: string;
}

interface Chunk {
  _id: string;
  documentId: string;
  content: string;
  index: number;
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

const DocumentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [document, setDocument] = useState<Document | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [activeTab, setActiveTab] = useState('info');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchDocument(id);
    }
  }, [id]);

  const fetchDocument = async (documentId: string) => {
    try {
      setIsLoading(true);
      const response = await knowledgeApi.getDocumentById(documentId);
      setDocument(response.data.document);
      
      // Fetch chunks if document is processed
      if (response.data.document.status === 'processed') {
        const chunksResponse = await knowledgeApi.getChunks({ documentId });
        setChunks(chunksResponse.data.chunks || []);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch document details'
      });
      console.error('Error fetching document:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteDocument = async () => {
    if (!id) return;
    
    if (!window.confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }

    try {
      setIsLoading(true);
      await knowledgeApi.deleteDocument(id);
      
      toast({
        title: 'Success',
        description: 'Document deleted successfully'
      });
      
      navigate('/knowledge');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete document'
      });
      console.error('Error deleting document:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="container mx-auto py-8">
        <Button variant="ghost" onClick={() => navigate('/knowledge')} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Knowledge Base
        </Button>
        
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Document not found</h3>
            <p className="text-gray-500 mb-6">The document you're looking for doesn't exist or you don't have permission to view it.</p>
            <Button onClick={() => navigate('/knowledge')}>
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Button variant="ghost" onClick={() => navigate('/knowledge')} className="mb-6">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Knowledge Base
      </Button>
      
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{document.fileName}</h1>
        <div className="flex gap-2">
          <Button variant="outline">
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
          <Button variant="destructive" onClick={handleDeleteDocument}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge 
              variant={
                document.status === 'processed' ? 'default' : 
                document.status === 'processing' ? 'outline' : 
                document.status === 'error' ? 'destructive' : 'secondary'
              }
              className="capitalize"
            >
              {document.status}
            </Badge>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">File Size</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatFileSize(document.fileSize)}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Chunks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{document.chunkCount || 0}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Created</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium">{new Date(document.createdAt).toLocaleDateString()}</p>
          </CardContent>
        </Card>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start mb-6">
          <TabsTrigger value="info">Document Info</TabsTrigger>
          <TabsTrigger value="chunks">Chunks ({document.chunkCount || 0})</TabsTrigger>
        </TabsList>
        
        <TabsContent value="info">
          <Card>
            <CardHeader>
              <CardTitle>Document Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">File Name</h3>
                <p>{document.fileName}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">File Type</h3>
                <p>{document.fileType}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">Category</h3>
                <p>{document.categoryId ? document.categoryId.name : 'None'}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {document.tags && document.tags.length > 0 ? (
                    document.tags.map((tag: string, index: number) => (
                      <Badge key={index} variant="outline" className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No tags</p>
                  )}
                </div>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
                <p>{document.description || 'No description provided'}</p>
              </div>
              
              {document.processingError && (
                <div>
                  <h3 className="text-sm font-medium text-destructive mb-1">Processing Error</h3>
                  <p className="text-destructive">{document.processingError}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="chunks">
          {document.status !== 'processed' ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-xl font-semibold mb-2">Document not yet processed</h3>
                <p className="text-gray-500 mb-6">
                  {document.status === 'processing' 
                    ? 'The document is currently being processed. Check back soon.'
                    : document.status === 'error'
                    ? 'An error occurred while processing this document.'
                    : 'The document is waiting to be processed.'}
                </p>
              </CardContent>
            </Card>
          ) : chunks.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Index</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chunks.map((chunk) => (
                  <TableRow key={chunk._id}>
                    <TableCell className="font-medium">{chunk.index + 1}</TableCell>
                    <TableCell className="max-w-lg">
                      <div className="max-h-32 overflow-auto">
                        {chunk.content.substring(0, 200)}
                        {chunk.content.length > 200 && '...'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {chunk.tags && chunk.tags.length > 0 ? (
                          chunk.tags.map((tag: string, index: number) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-xl font-semibold mb-2">No chunks found</h3>
                <p className="text-gray-500">This document has no content chunks.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DocumentDetail;
