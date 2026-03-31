import { useParams } from 'react-router-dom'

function ProjectPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <h1 className="text-2xl font-bold text-gray-800">Project {id}</h1>
    </div>
  )
}

export default ProjectPage
