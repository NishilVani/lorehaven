import EmptyPlate from '../../components/ui/EmptyPlate';
import PageHeader from '../../components/ui/PageHeader';
import { useParams, useNavigate } from 'react-router-dom';

export default function GameCollections() {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        <PageHeader
          back={{ label: 'Back to Game', onClick: () => navigate(`/game/${id}`) }}
          title="Game Collections"
        />

        <EmptyPlate title="Collections Disabled" body="Managing game collections is currently unavailable" />
      </div>
    </div>
  );
}
