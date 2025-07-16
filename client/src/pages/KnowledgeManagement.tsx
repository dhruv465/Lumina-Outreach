import { Edit, FileText, FolderTree, Plus, Search, Tag, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useToast } from '../hooks/useToast';
import api from '../services/api';

// Define interfaces
interface Document {
  _id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: 'processed' | 'processing' | 'error' | 'pending';
  categoryId?: {
    _id: string;
    name: string;
  };
  tags?: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  chunkCount?: number;
}

interface Category {
  _id: string;
  name: string;
  description?: string;
  parentId?: string;
  color?: string;
}

interface Tag {
  _id: string;
  name: string;
  description?: string;
  color?: string;
}

interface UploadedFile extends File {
  // Add any additional properties if needed
}

const KnowledgeManagement = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('documents');
  const [isLoading, setIsLoading] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFiles, setUploadFiles] = useState<UploadedFile[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [newCategoryParent, setNewCategoryParent] = useState('');
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  // Fetch initial data
  useEffect(() => {
    fetchDocuments();
    fetchCategories();
    fetchTags();
  }, []);

  // Fetch documents
  const fetchDocuments = async (filters = {}) => {
    try {
      setIsLoading(true);
      const response = await api.get('/api/knowledge/documents', { params: filters });
      setDocuments(response.data.documents || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch documents. Please try again.',
        variant: 'destructive'
      });
      console.error('Error fetching documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch categories
  const fetchCategories = async () => {
    try {
      const response = await api.get('/api/knowledge/categories');
      setCategories(response.data.categories || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch categories. Please try again.',
        variant: 'destructive'
      });
      console.error('Error fetching categories:', error);
    }
  };

  // Fetch tags
  const fetchTags = async () => {
    try {
      const response = await api.get('/api/knowledge/tags');
      setTags(response.data.tags || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch tags. Please try again.',
        variant: 'destructive'
      });
      console.error('Error fetching tags:', error);
    }
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileList = Array.from(e.target.files) as UploadedFile[];
      setUploadFiles(fileList);
    }
  };

  // Handle tag selection
  const handleTagSelect = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter(id => id !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  // Handle file upload
  const handleUpload = async () => {
    if (uploadFiles.length === 0) {
      toast({
        title: 'Warning',
        description: 'Please select at least one file to upload.',
        variant: 'default'
      });
      return;
    }

    try {
      setIsLoading(true);
      setUploadProgress(0);
      
      const formData = new FormData();
      uploadFiles.forEach(file => {
        formData.append('documents', file);
      });
      
      if (selectedCategory) {
        formData.append('categoryId', selectedCategory);
      }
      
      if (selectedTags.length > 0) {
        formData.append('tags', selectedTags.join(','));
      }
      
      
      toast({
        title: 'Success',
        description: `Successfully uploaded ${uploadFiles.length} document(s).`,
        variant: 'default'
      });
      
      // Reset form and close dialog
      setUploadFiles([]);
      setSelectedCategory('');
      setSelectedTags([]);
      setUploadDialogOpen(false);
      
      // Refresh documents list
      fetchDocuments();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to upload documents. Please try again.',
        variant: 'destructive'
      });
      console.error('Error uploading documents:', error);
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
    }
  };

  // Create new category
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) {
      toast({
        title: 'Warning',
        description: 'Please enter a category name.',
        variant: 'default'
      });
      return;
    }

    try {
      setIsLoading(true);
      
      const categoryData = {
        name: newCategoryName.trim(),
        description: newCategoryDescription.trim(),
        parentId: newCategoryParent || undefined
      };
      
      await api.post('/api/knowledge/categories', categoryData);
      
      toast({
        title: 'Success',
        description: 'Category created successfully.',
        variant: 'default'
      });
      
      // Reset form and close dialog
      setNewCategoryName('');
      setNewCategoryDescription('');
      setNewCategoryParent('');
      setCategoryDialogOpen(false);
      
      // Refresh categories
      fetchCategories();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create category. Please try again.',
        variant: 'destructive'
      });
      console.error('Error creating category:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Create new tag
  const handleCreateTag = async () => {
    if (!newTagName.trim()) {
      toast({
        title: 'Warning',
        description: 'Please enter a tag name.',
        variant: 'default'
      });
      return;
    }

    try {
      setIsLoading(true);
      
      const tagData = {
        name: newTagName.trim(),
        color: getRandomColor()
      };
      
      await api.post('/api/knowledge/tags', tagData);
      
      toast({
        title: 'Success',
        description: 'Tag created successfully.',
        variant: 'default'
      });
      
      // Reset form and close dialog
      setNewTagName('');
      setTagDialogOpen(false);
      
      // Refresh tags
      fetchTags();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create tag. Please try again.',
        variant: 'destructive'
      });
      console.error('Error creating tag:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete document
  const handleDeleteDocument = async (documentId: string) => {
    if (!window.confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }

    try {
      setIsLoading(true);
      
      await api.delete(`/api/knowledge/documents/${documentId}`);
      
      toast({
        title: 'Success',
        description: 'Document deleted successfully.',
        variant: 'default'
      });
      
      // Refresh documents list
      fetchDocuments();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete document. Please try again.',
        variant: 'destructive'
      });
      console.error('Error deleting document:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Search documents
  const handleSearch = () => {
    fetchDocuments({ query: searchQuery });
  };

  // Generate random color for tags
  const getRandomColor = () => {
    const colors = ['#FF5733', '#33FF57', '#3357FF', '#F033FF', '#FF33A8', '#33FFF6', '#FFE333'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // View document details
  const viewDocumentDetails = (documentId: string) => {
    navigate(`/knowledge/document/${documentId}`);
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Knowledge Management</h1>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start mb-8">
          <TabsTrigger value="documents" className="flex items-center">
            <FileText className="mr-2 h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center">
            <FolderTree className="mr-2 h-4 w-4" />
            Categories
          </TabsTrigger>
          <TabsTrigger value="tags" className="flex items-center">
            <Tag className="mr-2 h-4 w-4" />
            Tags
          </TabsTrigger>
        </TabsList>
        
        {/* Documents Tab */}
        <TabsContent value="documents">
          <div className="flex justify-between items-center mb-6">
            <div className="flex gap-2 w-2/3">
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
              <Button onClick={handleSearch} className="flex items-center">
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
            </div>
            <Button onClick={() => setUploadDialogOpen(true)} className="flex items-center">
              <UploadCloud className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
          
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Spinner size="lg" />
            </div>
          ) : documents.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc._id} className="cursor-pointer hover:bg-gray-50" onClick={() => viewDocumentDetails(doc._id)}>
                    <TableCell className="font-medium">{doc.fileName}</TableCell>
                    <TableCell>{doc.fileType}</TableCell>
                    <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                          doc.status === 'processed' ? 'default' : 
                          doc.status === 'processing' ? 'outline' : 
                          doc.status === 'error' ? 'destructive' : 'secondary'
                        }
                        className="capitalize"
                      >
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {doc.categoryId?.name || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {doc.tags?.map(tag => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        viewDocumentDetails(doc._id);
                      }}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDocument(doc._id);
                      }}>
                        <Trash2 className="h-4 w-4 text-red-500" />
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
                <h3 className="text-xl font-semibold mb-2">No documents found</h3>
                <p className="text-gray-500 mb-6">Upload documents to start building your knowledge base</p>
                <Button onClick={() => setUploadDialogOpen(true)}>
                  <UploadCloud className="mr-2 h-4 w-4" />
                  Upload Documents
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        {/* Categories Tab */}
        <TabsContent value="categories">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Document Categories</h2>
            <Button onClick={() => setCategoryDialogOpen(true)} className="flex items-center">
              <Plus className="mr-2 h-4 w-4" />
              New Category
            </Button>
          </div>
          
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Spinner size="lg" />
            </div>
          ) : categories.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((category) => (
                <Card key={category._id}>
                  <CardHeader>
                    <CardTitle>{category.name}</CardTitle>
                    {category.parentId && (
                      <CardDescription>
                        Parent: {categories.find(c => c._id === category.parentId)?.name || 'Unknown'}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-500">
                      {category.description || 'No description provided'}
                    </p>
                  </CardContent>
                  <CardFooter className="flex justify-between">
                    <Button variant="outline" onClick={() => {
                      fetchDocuments({ categoryId: category._id });
                      setActiveTab('documents');
                    }}>
                      View Documents
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Edit className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FolderTree className="h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-xl font-semibold mb-2">No categories found</h3>
                <p className="text-gray-500 mb-6">Create categories to organize your documents</p>
                <Button onClick={() => setCategoryDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Category
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        {/* Tags Tab */}
        <TabsContent value="tags">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Document Tags</h2>
            <Button onClick={() => setTagDialogOpen(true)} className="flex items-center">
              <Plus className="mr-2 h-4 w-4" />
              New Tag
            </Button>
          </div>
          
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Spinner size="lg" />
            </div>
          ) : tags.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {tags.map((tag) => (
                <Card key={tag._id}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-center">
                      <Badge 
                        style={{ backgroundColor: tag.color || '#333' }}
                        className="px-3 py-1"
                      >
                        {tag.name}
                      </Badge>
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={() => {
                        fetchDocuments({ tags: tag.name });
                        setActiveTab('documents');
                      }}
                    >
                      View Documents
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Tag className="h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-xl font-semibold mb-2">No tags found</h3>
                <p className="text-gray-500 mb-6">Create tags to organize your documents</p>
                <Button onClick={() => setTagDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Tag
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Documents</DialogTitle>
            <DialogDescription>
              Upload documents to your knowledge base. Supported formats: PDF, Word, Text, CSV, JSON, Markdown.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="documents">Select Files</Label>
              <Input
                id="documents"
                type="file"
                multiple
                onChange={handleFileSelect}
                className="cursor-pointer"
                accept=".pdf,.docx,.txt,.csv,.json,.md"
              />
              {uploadFiles.length > 0 && (
                <p className="text-sm text-gray-500">
                  {uploadFiles.length} file(s) selected
                </p>
              )}
            </div>
            
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="category">Category (Optional)</Label>
              <select
                id="category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">-- No Category --</option>
                {categories.map((category) => (
                  <option key={category._id} value={category._id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="grid w-full items-center gap-1.5">
              <Label>Tags (Optional)</Label>
              <div className="flex flex-wrap gap-2 border rounded-md p-2">
                {tags.map((tag) => (
                  <Badge
                    key={tag._id}
                    variant={selectedTags.includes(tag._id) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => handleTagSelect(tag._id)}
                    style={{
                      backgroundColor: selectedTags.includes(tag._id) ? tag.color : 'transparent',
                      borderColor: tag.color,
                      color: selectedTags.includes(tag._id) ? 'white' : 'inherit'
                    }}
                  >
                    {tag.name}
                  </Badge>
                ))}
                {tags.length === 0 && (
                  <p className="text-sm text-gray-500 py-1">No tags available</p>
                )}
              </div>
            </div>
            
            {uploadProgress > 0 && (
              <div className="w-full">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Uploading: {uploadProgress}%
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => setUploadDialogOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={uploadFiles.length === 0 || isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Uploading...
                </>
              ) : (
                <>
                  <UploadCloud className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* New Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
            <DialogDescription>
              Create a new category to organize your documents.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="categoryName">Category Name</Label>
              <Input
                id="categoryName"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Enter category name"
              />
            </div>
            
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="categoryDescription">Description (Optional)</Label>
              <Input
                id="categoryDescription"
                value={newCategoryDescription}
                onChange={(e) => setNewCategoryDescription(e.target.value)}
                placeholder="Enter category description"
              />
            </div>
            
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="parentCategory">Parent Category (Optional)</Label>
              <select
                id="parentCategory"
                value={newCategoryParent}
                onChange={(e) => setNewCategoryParent(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">-- No Parent --</option>
                {categories.map((category) => (
                  <option key={category._id} value={category._id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCategoryDialogOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateCategory}
              disabled={!newCategoryName.trim() || isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* New Tag Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Tag</DialogTitle>
            <DialogDescription>
              Create a new tag to organize your documents.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="tagName">Tag Name</Label>
              <Input
                id="tagName"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Enter tag name"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTagDialogOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTag}
              disabled={!newTagName.trim() || isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default KnowledgeManagement;
