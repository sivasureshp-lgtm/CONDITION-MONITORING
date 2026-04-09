import { useState, useEffect } from "react";
import axios from "axios";
import { Upload, Trash, File, FileText, Image as ImageIcon, Table } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const KnowledgeBase = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [docType, setDocType] = useState("Manual");
  const [machine, setMachine] = useState("");
  const [section, setSection] = useState("");

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/documents`);
      setDocuments(res.data);
    } catch (e) {
      console.error("Error fetching documents:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('doc_type', docType);
    if (machine) formData.append('machine', machine);
    if (section) formData.append('section', section);

    try {
      await axios.post(`${API}/documents/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSelectedFile(null);
      setMachine("");
      setSection("");
      document.getElementById('file-input').value = '';
      fetchDocuments();
    } catch (e) {
      console.error("Upload error:", e);
      alert(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    
    try {
      await axios.delete(`${API}/documents/${docId}`);
      fetchDocuments();
    } catch (e) {
      console.error("Delete error:", e);
    }
  };

  const getFileIcon = (filename) => {
    if (filename.endsWith('.pdf')) return <FileText size={20} weight="fill" />;
    if (filename.match(/\.(png|jpg|jpeg)$/)) return <ImageIcon size={20} weight="fill" />;
    if (filename.match(/\.(xlsx|xls)$/)) return <Table size={20} weight="fill" />;
    return <File size={20} weight="fill" />;
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'Manual': return 'border-[#002FA7] text-[#002FA7]';
      case 'SOP': return 'border-[#16A34A] text-[#16A34A]';
      case 'Drawing': return 'border-yellow-600 text-yellow-700';
      case 'History': return 'border-[#E11D48] text-[#E11D48]';
      default: return 'border-zinc-400 text-zinc-600';
    }
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-4xl font-light tracking-tight text-zinc-950">Knowledge Base</h1>
        <p className="text-sm text-zinc-700 mt-2">Manage plant documentation and technical resources</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
        {/* Upload Form */}
        <div className="col-span-1 md:col-span-4">
          <div className="border border-zinc-200 bg-white p-6">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Upload Document</h3>
            
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Document Type *
                </label>
                <select
                  data-testid="doc-type-select"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                >
                  <option value="Manual">Manual</option>
                  <option value="SOP">SOP</option>
                  <option value="Drawing">Drawing</option>
                  <option value="History">Incident History</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Machine / Equipment
                </label>
                <input
                  data-testid="doc-machine-input"
                  type="text"
                  value={machine}
                  onChange={(e) => setMachine(e.target.value)}
                  placeholder="e.g., Furnace-01"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  Section / Tag
                </label>
                <input
                  data-testid="doc-section-input"
                  type="text"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder="e.g., Temperature Control"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">
                  File (PDF, Image, Excel) *
                </label>
                <input
                  id="file-input"
                  data-testid="file-input"
                  type="file"
                  onChange={handleFileSelect}
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                  required
                />
              </div>

              <button
                data-testid="upload-btn"
                type="submit"
                disabled={uploading || !selectedFile}
                className="w-full bg-[#002FA7] text-white hover:bg-[#002FA7]/90 px-4 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {uploading ? (
                  <span>Uploading...</span>
                ) : (
                  <>
                    <Upload size={16} weight="fill" />
                    <span>Upload Document</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Documents List */}
        <div className="col-span-1 md:col-span-8">
          <div className="border border-zinc-200 bg-white">
            <div className="p-6 border-b border-zinc-200">
              <h3 className="text-lg font-medium tracking-tight text-zinc-900">Document Library</h3>
              <p className="text-sm text-zinc-600 mt-1">{documents.length} documents indexed</p>
            </div>

            {loading ? (
              <div className="p-6">
                <p className="text-sm text-zinc-600">Loading...</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-zinc-500">No documents uploaded yet</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    data-testid="document-item"
                    className="p-6 hover:bg-zinc-50 transition-colors duration-150"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <div className="text-zinc-600 mt-1">
                          {getFileIcon(doc.filename)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h4 className="text-sm font-medium text-zinc-950">{doc.filename}</h4>
                            <span className={`px-2 py-0.5 text-xs font-bold uppercase tracking-wider border rounded-none ${getTypeColor(doc.doc_type)}`}>
                              {doc.doc_type}
                            </span>
                          </div>
                          <div className="flex items-center space-x-4 text-xs text-zinc-500">
                            {doc.metadata?.machine && (
                              <span>Machine: {doc.metadata.machine}</span>
                            )}
                            {doc.metadata?.section && (
                              <span>Section: {doc.metadata.section}</span>
                            )}
                            <span>
                              {new Date(doc.uploaded_at).toLocaleDateString()}
                            </span>
                          </div>
                          {doc.content && (
                            <p className="text-sm text-zinc-600 mt-2 line-clamp-2">
                              {doc.content.substring(0, 200)}...
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        data-testid="delete-doc-btn"
                        onClick={() => handleDelete(doc.id)}
                        className="ml-4 p-2 text-zinc-400 hover:text-[#E11D48] transition-colors duration-150"
                      >
                        <Trash size={18} weight="fill" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBase;